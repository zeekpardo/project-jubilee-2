/**
 * Project Jubilee seed — the WRITE layer.
 *
 * Internal mutations only. Every transformation lives in `./transform.ts`; the
 * Node driver (`scripts/seed-jubilee.ts`) reads the source JSON, builds the
 * plan, validates the money totals, and then calls these in dependency order:
 *
 *   prepare → wipe (loop) → seedFoundation → seedProjects → seedBudgets
 *          → seedDocuments → seedPeople → seedSponsors → seedMoney → verify
 *
 * The work is split because ~700 documents will not fit comfortably in one
 * transaction, and because a failed batch should be re-runnable on its own.
 * Every mutation is therefore idempotent: it looks the row up by its natural
 * key first and patches instead of inserting.
 *
 * Wipe scope: seed-owned rows for the Jubilee campaign ONLY. The org, its
 * users, and the auth tables are never touched, and neither is the campaign
 * row itself.
 */
import { ConvexError, v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { internalMutation } from '../functions';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { createCampaignModel } from '../model/campaigns';
import { createContactModel } from '../model/contacts';
import { createProjectModel } from '../model/projects';
import { attributeValueValidator } from '../model/customFields';
import { householdRoleValidator } from '../model/memberships';
import { transactionTypeValidator } from '../model/money';
import { budgetTarget } from '../../lib/domain/budget';
import { reconciliation } from '../../lib/domain/reconciliation';
import {
	JUBILEE_CAMPAIGN,
	JUBILEE_CAMPAIGN_SLUG,
	JUBILEE_ORG_SETTINGS,
	SEED_CONTACT_REMOTE_ID_PREFIX,
	SEED_TRANSACTION_NOTE_PREFIX
} from './transform';

// ---------------------------------------------------------------------------
// Shared validators (mirror the plan types in ./transform.ts)
// ---------------------------------------------------------------------------

const attributesValidator = v.record(v.string(), attributeValueValidator);
const centsRecordValidator = v.record(v.string(), v.number());

const stageValidator = v.object({
	key: v.string(),
	label: v.string(),
	order: v.number(),
	kind: v.union(v.literal('funnel'), v.literal('terminal')),
	accent: v.string(),
	isDefault: v.boolean(),
	isFundedGate: v.boolean(),
	isSystem: v.boolean()
});

const fieldDefinitionValidator = v.object({
	key: v.string(),
	label: v.string(),
	type: v.union(
		v.literal('text'),
		v.literal('longtext'),
		v.literal('number'),
		v.literal('money'),
		v.literal('date'),
		v.literal('select'),
		v.literal('boolean')
	),
	order: v.number(),
	isRequired: v.boolean(),
	isPublic: v.boolean()
});

const documentKindValidator = v.union(
	v.literal('debt_evidence'),
	v.literal('receipt'),
	v.literal('legal_certificate'),
	v.literal('photo'),
	v.literal('agreement'),
	v.literal('other')
);

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

async function findCampaign(ctx: QueryCtx, orgId: string): Promise<Doc<'campaigns'> | null> {
	return await ctx.db
		.query('campaigns')
		.withIndex('by_orgId_and_slug', (q) => q.eq('orgId', orgId).eq('slug', JUBILEE_CAMPAIGN_SLUG))
		.unique();
}

async function requireCampaign(ctx: QueryCtx, orgId: string): Promise<Doc<'campaigns'>> {
	const campaign = await findCampaign(ctx, orgId);
	if (!campaign) {
		throw new ConvexError(
			`No campaign with slug "${JUBILEE_CAMPAIGN_SLUG}" in org ${orgId} — run seed/jubilee:prepare first`
		);
	}
	return campaign;
}

async function requireProjectByNumber(
	ctx: QueryCtx,
	campaignId: Id<'campaigns'>,
	number: string
): Promise<Doc<'projects'>> {
	const project = await ctx.db
		.query('projects')
		.withIndex('by_campaignId_and_number', (q) =>
			q.eq('campaignId', campaignId).eq('number', number)
		)
		.unique();
	if (!project) {
		throw new ConvexError(`Project ${number} not found — run seed/jubilee:seedProjects first`);
	}
	return project;
}

async function findContactByRemoteId(
	ctx: QueryCtx,
	orgId: string,
	remoteId: string
): Promise<Doc<'contacts'> | null> {
	return await ctx.db
		.query('contacts')
		.withIndex('by_orgId_and_remoteId', (q) => q.eq('orgId', orgId).eq('remoteId', remoteId))
		.unique();
}

/** unique(campaignId, contactId, role) — Convex has no unique constraints. */
async function ensureCampaignMembership(
	ctx: MutationCtx,
	orgId: string,
	campaignId: Id<'campaigns'>,
	contactId: Id<'contacts'>,
	role: string
): Promise<void> {
	const existing = await ctx.db
		.query('campaignMemberships')
		.withIndex('by_campaignId_and_contactId', (q) =>
			q.eq('campaignId', campaignId).eq('contactId', contactId)
		)
		.collect();
	if (existing.some((row) => row.role === role)) return;
	await ctx.db.insert('campaignMemberships', { orgId, campaignId, contactId, role });
}

/** unique(projectId, contactId) — patched rather than duplicated on a re-run. */
async function upsertProjectMember(
	ctx: MutationCtx,
	orgId: string,
	projectId: Id<'projects'>,
	contactId: Id<'contacts'>,
	role: string,
	attributes: Record<string, string | number | boolean | null>
): Promise<void> {
	const existing = await ctx.db
		.query('projectMembers')
		.withIndex('by_projectId_and_contactId', (q) =>
			q.eq('projectId', projectId).eq('contactId', contactId)
		)
		.unique();
	if (existing) {
		await ctx.db.patch('projectMembers', existing._id, { role, attributes });
		return;
	}
	await ctx.db.insert('projectMembers', { orgId, projectId, contactId, role, attributes });
}

function assertIntegerCents(label: string, cents: number): void {
	if (!Number.isInteger(cents)) {
		throw new ConvexError(`${label} must be an integer number of cents`);
	}
}

// ---------------------------------------------------------------------------
// 1. prepare — org settings + the campaign itself (created only if absent)
// ---------------------------------------------------------------------------

export const prepare = internalMutation({
	args: { orgId: v.string() },
	returns: v.object({
		campaignId: v.id('campaigns'),
		createdCampaign: v.boolean()
	}),
	handler: async (ctx, args) => {
		// Org settings are ORG-level, not campaign-level, so they are never wiped.
		// Absent → create; present → only fill in fields the org has not set, so a
		// reseed cannot clobber a workspace someone has already configured.
		const settings = await ctx.db
			.query('orgSettings')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.unique();
		const slugTaken = await ctx.db
			.query('orgSettings')
			.withIndex('by_slug', (q) => q.eq('slug', JUBILEE_ORG_SETTINGS.slug))
			.first();

		if (!settings) {
			await ctx.db.insert('orgSettings', {
				orgId: args.orgId,
				campaignLabel: 'Campaign',
				campaignLabelPlural: 'Campaigns',
				slug: slugTaken ? undefined : JUBILEE_ORG_SETTINGS.slug,
				theme: JUBILEE_ORG_SETTINGS.theme,
				publicName: JUBILEE_ORG_SETTINGS.publicName,
				publicTagline: JUBILEE_ORG_SETTINGS.publicTagline
			});
		} else {
			const patch: Partial<Doc<'orgSettings'>> = {};
			if (settings.slug === undefined && !slugTaken) patch.slug = JUBILEE_ORG_SETTINGS.slug;
			if (settings.theme === undefined) patch.theme = JUBILEE_ORG_SETTINGS.theme;
			if (settings.publicName === undefined) patch.publicName = JUBILEE_ORG_SETTINGS.publicName;
			if (settings.publicTagline === undefined) {
				patch.publicTagline = JUBILEE_ORG_SETTINGS.publicTagline;
			}
			if (Object.keys(patch).length > 0) {
				await ctx.db.patch('orgSettings', settings._id, patch);
			}
		}

		// Convex ids cannot be forced, so the reference's fixed campaign UUID does
		// not port: the campaign is resolved by slug and created only if absent.
		const existing = await findCampaign(ctx, args.orgId);
		if (existing) {
			// objectSlug is deliberately not patched — it is frozen at creation so
			// renaming the label never breaks public URLs.
			await ctx.db.patch('campaigns', existing._id, {
				name: JUBILEE_CAMPAIGN.name,
				status: JUBILEE_CAMPAIGN.status,
				numberPrefix: JUBILEE_CAMPAIGN.numberPrefix,
				objectLabel: JUBILEE_CAMPAIGN.objectLabel,
				objectLabelPlural: JUBILEE_CAMPAIGN.objectLabelPlural,
				membersEnabled: JUBILEE_CAMPAIGN.membersEnabled,
				budgetShape: JUBILEE_CAMPAIGN.budgetShape,
				goalLabel: JUBILEE_CAMPAIGN.goalLabel,
				goalVerb: JUBILEE_CAMPAIGN.goalVerb,
				goalTrigger: JUBILEE_CAMPAIGN.goalTrigger,
				isPublished: JUBILEE_CAMPAIGN.isPublished
			});
			return { campaignId: existing._id, createdCampaign: false };
		}

		const campaignId = await createCampaignModel(ctx, {
			orgId: args.orgId,
			name: JUBILEE_CAMPAIGN.name,
			slug: JUBILEE_CAMPAIGN.slug,
			status: JUBILEE_CAMPAIGN.status,
			numberPrefix: JUBILEE_CAMPAIGN.numberPrefix,
			objectLabel: JUBILEE_CAMPAIGN.objectLabel,
			objectLabelPlural: JUBILEE_CAMPAIGN.objectLabelPlural,
			membersEnabled: JUBILEE_CAMPAIGN.membersEnabled,
			budgetShape: JUBILEE_CAMPAIGN.budgetShape,
			goalLabel: JUBILEE_CAMPAIGN.goalLabel,
			goalVerb: JUBILEE_CAMPAIGN.goalVerb,
			goalTrigger: JUBILEE_CAMPAIGN.goalTrigger,
			isPublished: JUBILEE_CAMPAIGN.isPublished
		});
		return { campaignId, createdCampaign: true };
	}
});

// ---------------------------------------------------------------------------
// 2. wipe — delete seed-owned rows, scoped to the campaign
// ---------------------------------------------------------------------------

/**
 * Deletes at most `limit` documents per call and reports whether anything is
 * left, so the driver can loop. Each call re-queries from scratch, which is
 * what makes an interrupted wipe safe to resume.
 *
 * NEVER deleted here: the campaign, orgSettings, the organization, users, or
 * any Better Auth table.
 */
export const wipe = internalMutation({
	args: { orgId: v.string(), limit: v.optional(v.number()) },
	returns: v.object({ deleted: v.number(), done: v.boolean() }),
	handler: async (ctx, args) => {
		const campaign = await requireCampaign(ctx, args.orgId);
		const limit = args.limit ?? 600;
		let deleted = 0;
		const exhausted = (): boolean => deleted >= limit;

		// -- Allocations (leaf) --------------------------------------------------
		const allocations = await ctx.db
			.query('allocations')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.collect();
		for (const allocation of allocations) {
			if (exhausted()) return { deleted, done: false };
			await ctx.db.delete('allocations', allocation._id);
			deleted++;
		}

		// -- Transactions -------------------------------------------------------
		// A transaction carries no campaignId, so the seed marker in `note` is the
		// only thing that identifies it as seed-owned. Hand-entered transactions
		// have no marker and survive.
		const transactions = await ctx.db
			.query('transactions')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.collect();
		for (const transaction of transactions) {
			if (transaction.note === undefined) continue;
			if (!transaction.note.startsWith(SEED_TRANSACTION_NOTE_PREFIX)) continue;
			if (exhausted()) return { deleted, done: false };
			// Any allocation on a seeded transaction that pointed at another
			// campaign would be orphaned, so clear them all first.
			const orphans = await ctx.db
				.query('allocations')
				.withIndex('by_transactionId', (q) => q.eq('transactionId', transaction._id))
				.collect();
			for (const orphan of orphans) {
				await ctx.db.delete('allocations', orphan._id);
				deleted++;
			}
			await ctx.db.delete('transactions', transaction._id);
			deleted++;
		}

		// -- Projects and everything hanging off them ---------------------------
		const projects = await ctx.db
			.query('projects')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.collect();
		for (const project of projects) {
			if (exhausted()) return { deleted, done: false };

			const budgets = await ctx.db
				.query('budgets')
				.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
				.collect();
			for (const budget of budgets) {
				await ctx.db.delete('budgets', budget._id);
				deleted++;
			}

			const documents = await ctx.db
				.query('documents')
				.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
				.collect();
			for (const document of documents) {
				if (document.storageId) {
					await ctx.storage.delete(document.storageId);
				}
				await ctx.db.delete('documents', document._id);
				deleted++;
			}

			// Only the link rows go; the contacts are handled below, by marker.
			const members = await ctx.db
				.query('projectMembers')
				.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
				.collect();
			for (const member of members) {
				await ctx.db.delete('projectMembers', member._id);
				deleted++;
			}

			// The uploaded family photo goes with the project. Without this every
			// reseed would orphan one blob per project in storage, with nothing
			// left referencing it and no way to find it again.
			if (project.photoStorageId) {
				await ctx.storage.delete(project.photoStorageId);
			}

			await ctx.db.delete('projects', project._id);
			deleted++;
		}

		// -- Seed-created contacts ----------------------------------------------
		// Identified by the remoteId marker, so people added by hand are safe.
		const contacts = await ctx.db
			.query('contacts')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.collect();
		for (const contact of contacts) {
			if (contact.remoteId === undefined) continue;
			if (!contact.remoteId.startsWith(SEED_CONTACT_REMOTE_ID_PREFIX)) continue;
			if (exhausted()) return { deleted, done: false };

			for (const email of await ctx.db
				.query('contactEmails')
				.withIndex('by_contactId', (q) => q.eq('contactId', contact._id))
				.collect()) {
				await ctx.db.delete('contactEmails', email._id);
				deleted++;
			}
			for (const phone of await ctx.db
				.query('contactPhones')
				.withIndex('by_contactId', (q) => q.eq('contactId', contact._id))
				.collect()) {
				await ctx.db.delete('contactPhones', phone._id);
				deleted++;
			}
			for (const address of await ctx.db
				.query('contactAddresses')
				.withIndex('by_contactId', (q) => q.eq('contactId', contact._id))
				.collect()) {
				await ctx.db.delete('contactAddresses', address._id);
				deleted++;
			}
			for (const check of await ctx.db
				.query('contactBackgroundChecks')
				.withIndex('by_contactId', (q) => q.eq('contactId', contact._id))
				.collect()) {
				await ctx.db.delete('contactBackgroundChecks', check._id);
				deleted++;
			}

			// Drop the household link, then the household itself once its last
			// member is gone. A household that still holds a non-seed contact is
			// left standing.
			for (const link of await ctx.db
				.query('householdMembers')
				.withIndex('by_contactId', (q) => q.eq('contactId', contact._id))
				.collect()) {
				const householdId = link.householdId;
				await ctx.db.delete('householdMembers', link._id);
				deleted++;
				const remaining = await ctx.db
					.query('householdMembers')
					.withIndex('by_householdId', (q) => q.eq('householdId', householdId))
					.first();
				if (!remaining) {
					const household = await ctx.db.get('households', householdId);
					if (household && household.orgId === args.orgId) {
						await ctx.db.delete('households', householdId);
						deleted++;
					}
				}
			}

			for (const membership of await ctx.db
				.query('campaignMemberships')
				.withIndex('by_contactId', (q) => q.eq('contactId', contact._id))
				.collect()) {
				await ctx.db.delete('campaignMemberships', membership._id);
				deleted++;
			}
			for (const link of await ctx.db
				.query('projectMembers')
				.withIndex('by_contactId', (q) => q.eq('contactId', contact._id))
				.collect()) {
				await ctx.db.delete('projectMembers', link._id);
				deleted++;
			}

			await ctx.db.delete('contacts', contact._id);
			deleted++;
		}

		// -- Campaign-scoped configuration --------------------------------------
		for (const stage of await ctx.db
			.query('pipelineStages')
			.withIndex('by_campaignId_and_order', (q) => q.eq('campaignId', campaign._id))
			.collect()) {
			if (exhausted()) return { deleted, done: false };
			await ctx.db.delete('pipelineStages', stage._id);
			deleted++;
		}
		for (const costTemplate of await ctx.db
			.query('costTemplates')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.collect()) {
			if (exhausted()) return { deleted, done: false };
			await ctx.db.delete('costTemplates', costTemplate._id);
			deleted++;
		}
		for (const taskTemplate of await ctx.db
			.query('taskTemplates')
			.withIndex('by_campaignId_and_version', (q) => q.eq('campaignId', campaign._id))
			.collect()) {
			if (exhausted()) return { deleted, done: false };
			await ctx.db.delete('taskTemplates', taskTemplate._id);
			deleted++;
		}
		// Definitions before categories: a definition points at its category.
		for (const entity of ['contact', 'project', 'campaign'] as const) {
			for (const definition of await ctx.db
				.query('customFieldDefinitions')
				.withIndex('by_orgId_and_entity', (q) => q.eq('orgId', args.orgId).eq('entity', entity))
				.collect()) {
				if (definition.campaignId !== campaign._id) continue;
				if (exhausted()) return { deleted, done: false };
				await ctx.db.delete('customFieldDefinitions', definition._id);
				deleted++;
			}
		}
		for (const category of await ctx.db
			.query('customFieldCategories')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.collect()) {
			if (exhausted()) return { deleted, done: false };
			await ctx.db.delete('customFieldCategories', category._id);
			deleted++;
		}

		return { deleted, done: true };
	}
});

// ---------------------------------------------------------------------------
// 3. seedFoundation — stages, cost/task templates, custom fields
// ---------------------------------------------------------------------------

export const seedFoundation = internalMutation({
	args: {
		orgId: v.string(),
		stages: v.array(stageValidator),
		costTemplates: v.array(v.object({ version: v.string(), lineItems: centsRecordValidator })),
		taskTemplate: v.object({
			version: v.string(),
			effectiveFrom: v.string(),
			isActive: v.boolean(),
			items: v.array(
				v.object({
					key: v.string(),
					label: v.string(),
					order: v.number(),
					impactTag: v.optional(v.string())
				})
			)
		}),
		fieldCategory: v.object({ name: v.string(), order: v.number() }),
		fieldDefinitions: v.array(fieldDefinitionValidator)
	},
	returns: v.object({
		stages: v.number(),
		costTemplates: v.number(),
		taskTemplates: v.number(),
		fieldCategories: v.number(),
		fieldDefinitions: v.number()
	}),
	handler: async (ctx, args) => {
		const campaign = await requireCampaign(ctx, args.orgId);

		for (const stage of args.stages) {
			const existing = await ctx.db
				.query('pipelineStages')
				.withIndex('by_campaignId_and_key', (q) =>
					q.eq('campaignId', campaign._id).eq('key', stage.key)
				)
				.unique();
			if (existing) {
				await ctx.db.patch('pipelineStages', existing._id, stage);
			} else {
				await ctx.db.insert('pipelineStages', {
					orgId: args.orgId,
					campaignId: campaign._id,
					...stage
				});
			}
		}

		for (const costTemplate of args.costTemplates) {
			const existing = await ctx.db
				.query('costTemplates')
				.withIndex('by_campaignId_and_version', (q) =>
					q.eq('campaignId', campaign._id).eq('version', costTemplate.version)
				)
				.unique();
			if (existing) {
				await ctx.db.patch('costTemplates', existing._id, { lineItems: costTemplate.lineItems });
			} else {
				await ctx.db.insert('costTemplates', {
					orgId: args.orgId,
					campaignId: campaign._id,
					version: costTemplate.version,
					lineItems: costTemplate.lineItems
				});
			}
		}

		// Exactly one isActive per campaign — demote any other version first.
		const taskTemplates = await ctx.db
			.query('taskTemplates')
			.withIndex('by_campaignId_and_version', (q) => q.eq('campaignId', campaign._id))
			.collect();
		for (const row of taskTemplates) {
			if (row.version !== args.taskTemplate.version && row.isActive) {
				await ctx.db.patch('taskTemplates', row._id, { isActive: false });
			}
		}
		const existingTaskTemplate = taskTemplates.find(
			(row) => row.version === args.taskTemplate.version
		);
		if (existingTaskTemplate) {
			await ctx.db.patch('taskTemplates', existingTaskTemplate._id, {
				effectiveFrom: args.taskTemplate.effectiveFrom,
				isActive: args.taskTemplate.isActive,
				items: args.taskTemplate.items
			});
		} else {
			await ctx.db.insert('taskTemplates', {
				orgId: args.orgId,
				campaignId: campaign._id,
				version: args.taskTemplate.version,
				effectiveFrom: args.taskTemplate.effectiveFrom,
				isActive: args.taskTemplate.isActive,
				items: args.taskTemplate.items
			});
		}

		// The campaign's "Details" card: one category holding the three fields that
		// used to be dedicated columns on `families`, plus the two link fields the
		// sheet's `link` column is split into.
		const categories = await ctx.db
			.query('customFieldCategories')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.collect();
		const existingCategory = categories.find(
			(row) => row.entity === 'project' && row.name === args.fieldCategory.name
		);
		let categoryId: Id<'customFieldCategories'>;
		if (existingCategory) {
			categoryId = existingCategory._id;
			await ctx.db.patch('customFieldCategories', categoryId, {
				order: args.fieldCategory.order
			});
		} else {
			categoryId = await ctx.db.insert('customFieldCategories', {
				orgId: args.orgId,
				entity: 'project',
				scope: 'campaign',
				campaignId: campaign._id,
				name: args.fieldCategory.name,
				order: args.fieldCategory.order
			});
		}

		for (const definition of args.fieldDefinitions) {
			const existing = await ctx.db
				.query('customFieldDefinitions')
				.withIndex('by_campaignId_and_entity_and_key', (q) =>
					q.eq('campaignId', campaign._id).eq('entity', 'project').eq('key', definition.key)
				)
				.unique();
			if (existing) {
				await ctx.db.patch('customFieldDefinitions', existing._id, {
					categoryId,
					label: definition.label,
					type: definition.type,
					order: definition.order,
					isRequired: definition.isRequired,
					isPublic: definition.isPublic
				});
			} else {
				await ctx.db.insert('customFieldDefinitions', {
					orgId: args.orgId,
					entity: 'project',
					scope: 'campaign',
					campaignId: campaign._id,
					categoryId,
					key: definition.key,
					label: definition.label,
					type: definition.type,
					order: definition.order,
					isRequired: definition.isRequired,
					isPublic: definition.isPublic
				});
			}
		}

		return {
			stages: args.stages.length,
			costTemplates: args.costTemplates.length,
			taskTemplates: 1,
			fieldCategories: 1,
			fieldDefinitions: args.fieldDefinitions.length
		};
	}
});

// ---------------------------------------------------------------------------
// 4. seedProjects
// ---------------------------------------------------------------------------

export const seedProjects = internalMutation({
	args: {
		orgId: v.string(),
		projects: v.array(
			v.object({
				number: v.string(),
				name: v.string(),
				stage: v.string(),
				story: v.optional(v.string()),
				attributes: attributesValidator,
				isPublished: v.boolean(),
				publishedAt: v.optional(v.number()),
				isGoalMet: v.boolean(),
				goalMetAt: v.optional(v.number())
			})
		)
	},
	returns: v.object({ inserted: v.number(), updated: v.number() }),
	handler: async (ctx, args) => {
		const campaign = await requireCampaign(ctx, args.orgId);
		let inserted = 0;
		let updated = 0;

		for (const project of args.projects) {
			const existing = await ctx.db
				.query('projects')
				.withIndex('by_campaignId_and_number', (q) =>
					q.eq('campaignId', campaign._id).eq('number', project.number)
				)
				.unique();

			// publishedAt/goalMetAt are always written, undefined included, so a
			// re-run that demotes a project also clears its stamp.
			const stamps = {
				publishedAt: project.publishedAt,
				goalMetAt: project.goalMetAt,
				story: project.story
			};

			if (existing) {
				await ctx.db.patch('projects', existing._id, {
					name: project.name,
					stage: project.stage,
					attributes: project.attributes,
					isPublished: project.isPublished,
					isGoalMet: project.isGoalMet,
					...stamps
				});
				updated++;
				continue;
			}

			const projectId = await createProjectModel(ctx, {
				orgId: args.orgId,
				campaignId: campaign._id,
				number: project.number,
				name: project.name,
				stage: project.stage,
				story: project.story,
				attributes: project.attributes,
				isPublished: project.isPublished,
				isGoalMet: project.isGoalMet
			});
			await ctx.db.patch('projects', projectId, stamps);
			inserted++;
		}

		return { inserted, updated };
	}
});

// ---------------------------------------------------------------------------
// 5. seedBudgets
// ---------------------------------------------------------------------------

/**
 * `targetCents` comes from the sheet's `grand_total`, NOT from `budgetTarget()`
 * — that is deliberate, and matches the reference. The computed value is
 * returned alongside so the driver can log the variance (P-009 is $500 out
 * because the template's `admin` line is missing from the sheet total).
 */
export const seedBudgets = internalMutation({
	args: {
		orgId: v.string(),
		budgets: v.array(
			v.object({
				projectNumber: v.string(),
				templateVersion: v.string(),
				templateSnapshot: centsRecordValidator,
				debtCents: v.number(),
				targetCents: v.number()
			})
		)
	},
	returns: v.object({
		inserted: v.number(),
		updated: v.number(),
		variances: v.array(v.object({ projectNumber: v.string(), deltaCents: v.number() }))
	}),
	handler: async (ctx, args) => {
		const campaign = await requireCampaign(ctx, args.orgId);
		let inserted = 0;
		let updated = 0;
		const variances: { projectNumber: string; deltaCents: number }[] = [];

		for (const budget of args.budgets) {
			const project = await requireProjectByNumber(ctx, campaign._id, budget.projectNumber);
			assertIntegerCents(`${budget.projectNumber} debtCents`, budget.debtCents);
			assertIntegerCents(`${budget.projectNumber} targetCents`, budget.targetCents);
			for (const key of Object.keys(budget.templateSnapshot)) {
				assertIntegerCents(`${budget.projectNumber} ${key}`, budget.templateSnapshot[key]);
			}

			const computed = budgetTarget(budget.templateSnapshot, budget.debtCents, []);
			if (computed !== budget.targetCents) {
				variances.push({
					projectNumber: budget.projectNumber,
					deltaCents: budget.targetCents - computed
				});
			}

			const fields = {
				templateVersion: budget.templateVersion,
				templateSnapshot: budget.templateSnapshot,
				debtCents: budget.debtCents,
				extras: [],
				targetCents: budget.targetCents
			};

			const existing = await ctx.db
				.query('budgets')
				.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
				.unique();
			if (existing) {
				await ctx.db.patch('budgets', existing._id, fields);
				updated++;
			} else {
				await ctx.db.insert('budgets', { orgId: args.orgId, projectId: project._id, ...fields });
				inserted++;
			}
		}

		return { inserted, updated, variances };
	}
});

// ---------------------------------------------------------------------------
// 6. seedDocuments
// ---------------------------------------------------------------------------

export const seedDocuments = internalMutation({
	args: {
		orgId: v.string(),
		documents: v.array(
			v.object({
				projectNumber: v.string(),
				stage: v.string(),
				kind: documentKindValidator,
				notes: v.optional(v.string())
			})
		)
	},
	returns: v.object({ inserted: v.number(), skipped: v.number() }),
	handler: async (ctx, args) => {
		const campaign = await requireCampaign(ctx, args.orgId);
		const stages = await ctx.db
			.query('pipelineStages')
			.withIndex('by_campaignId_and_order', (q) => q.eq('campaignId', campaign._id))
			.collect();
		const stageKeys = new Set(stages.map((stage) => stage.key));

		let inserted = 0;
		let skipped = 0;
		for (const document of args.documents) {
			if (!stageKeys.has(document.stage)) {
				throw new ConvexError(`Invalid stage: ${document.stage}`);
			}
			const project = await requireProjectByNumber(ctx, campaign._id, document.projectNumber);
			// A seeded document has no natural key of its own, so
			// (project, stage, kind, notes) stands in for one.
			const siblings = await ctx.db
				.query('documents')
				.withIndex('by_projectId_and_stage', (q) =>
					q.eq('projectId', project._id).eq('stage', document.stage)
				)
				.collect();
			if (siblings.some((row) => row.kind === document.kind && row.notes === document.notes)) {
				skipped++;
				continue;
			}
			await ctx.db.insert('documents', {
				orgId: args.orgId,
				projectId: project._id,
				stage: document.stage,
				kind: document.kind,
				notes: document.notes
			});
			inserted++;
		}

		return { inserted, skipped };
	}
});

// ---------------------------------------------------------------------------
// 6b. seedMilestoneTasks — the active checklist, applied to every project
// ---------------------------------------------------------------------------
// A direct port of the reference's milestone-task seeding (scripts/seed.ts,
// "Milestone tasks"). Every project except the freed-by-other off-ramp gets the
// active template's checklist; a project whose goal is met has the "delivered"
// items marked done, so the business/school impact counts reflect what the
// reference reported.
//
// HONESTY NOTE, carried over from the reference: the source spreadsheet's
// `tuktuk` milestone column is empty for every family, so neither app measures
// these deliveries. Both ASSERT that a freed family received a tuk-tuk and had
// its children enrolled — that is the seeding convention, not evidence. The
// numbers are as accurate as the reference's, which is what "matching" means
// here; they are not audited facts.

/** Items a goal-met project has already completed. Mirrors FREED_DONE_KEYS. */
const FREED_DONE_KEYS = new Set([
	'debt_paid',
	'certificate_of_freedom',
	'tuktuk_delivered',
	'school_enrolled'
]);

/** The reference stamps completions with its placeholder rescue date. */
const PLACEHOLDER_COMPLETED_AT = Date.parse('2025-09-01T00:00:00Z');

export const seedMilestoneTasks = internalMutation({
	args: { orgId: v.string() },
	returns: v.object({ inserted: v.number(), completed: v.number(), skipped: v.number() }),
	handler: async (ctx, args) => {
		const campaign = await requireCampaign(ctx, args.orgId);

		const template = await ctx.db
			.query('taskTemplates')
			.withIndex('by_campaignId_and_isActive', (q) =>
				q.eq('campaignId', campaign._id).eq('isActive', true)
			)
			.unique();
		if (!template) {
			throw new ConvexError('This campaign has no active task template');
		}

		const projects = await ctx.db
			.query('projects')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.collect();

		let inserted = 0;
		let completed = 0;
		let skipped = 0;

		for (const project of projects) {
			// Never in our pipeline: this family was freed by another org.
			if (project.stage === 'freed_by_other') continue;

			const existing = await ctx.db
				.query('tasks')
				.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
				.collect();
			const have = new Set(existing.map((task) => task.key));

			for (const item of template.items) {
				if (have.has(item.key)) {
					skipped++;
					continue;
				}
				const done = project.isGoalMet && FREED_DONE_KEYS.has(item.key);
				await ctx.db.insert('tasks', {
					orgId: args.orgId,
					projectId: project._id,
					campaignId: campaign._id,
					source: 'template' as const,
					priority: 'normal' as const,
					templateVersion: template.version,
					key: item.key,
					label: item.label,
					order: item.order,
					...(item.impactTag ? { impactTag: item.impactTag } : {}),
					status: done ? ('done' as const) : ('todo' as const),
					// goalMetAt when the project carries one, so a date-filtered
					// dashboard places the completion at the same moment the
					// record was freed rather than at seed time.
					...(done ? { completedAt: project.goalMetAt ?? PLACEHOLDER_COMPLETED_AT } : {})
				});
				inserted++;
				if (done) completed++;
			}
		}

		return { inserted, completed, skipped };
	}
});

// ---------------------------------------------------------------------------
// 7. seedPeople — member contacts, households, project links
// ---------------------------------------------------------------------------

export const seedPeople = internalMutation({
	args: {
		orgId: v.string(),
		households: v.array(
			v.object({
				projectNumber: v.string(),
				householdName: v.string(),
				members: v.array(
					v.object({
						remoteId: v.string(),
						firstName: v.string(),
						lastName: v.optional(v.string()),
						relationship: v.optional(v.string()),
						householdRole: householdRoleValidator
					})
				)
			})
		)
	},
	returns: v.object({
		contacts: v.number(),
		households: v.number(),
		householdMembers: v.number(),
		projectMembers: v.number()
	}),
	handler: async (ctx, args) => {
		const campaign = await requireCampaign(ctx, args.orgId);
		let contactCount = 0;
		let householdCount = 0;
		let householdMemberCount = 0;
		let projectMemberCount = 0;

		for (const group of args.households) {
			const project = await requireProjectByNumber(ctx, campaign._id, group.projectNumber);

			const contactIds: Id<'contacts'>[] = [];
			for (const member of group.members) {
				const existing = await findContactByRemoteId(ctx, args.orgId, member.remoteId);
				let contactId: Id<'contacts'>;
				if (existing) {
					await ctx.db.patch('contacts', existing._id, {
						firstName: member.firstName,
						lastName: member.lastName
					});
					contactId = existing._id;
				} else {
					contactId = await createContactModel(ctx, {
						orgId: args.orgId,
						firstName: member.firstName,
						lastName: member.lastName,
						source: 'project_member',
						remoteId: member.remoteId
					});
				}
				contactIds.push(contactId);
				contactCount++;

				await upsertProjectMember(
					ctx,
					args.orgId,
					project._id,
					contactId,
					'member',
					member.relationship === undefined ? {} : { relationship: member.relationship }
				);
				projectMemberCount++;
				await ensureCampaignMembership(ctx, args.orgId, campaign._id, contactId, 'member');
			}

			if (contactIds.length === 0) continue;

			// The household is reached through its primary contact's existing link,
			// which is the only identifier a re-run can rely on (households have no
			// natural key of their own).
			const primaryContactId = contactIds[0];
			const primaryLink = await ctx.db
				.query('householdMembers')
				.withIndex('by_contactId', (q) => q.eq('contactId', primaryContactId))
				.first();
			let householdId: Id<'households'>;
			if (primaryLink) {
				householdId = primaryLink.householdId;
				await ctx.db.patch('households', householdId, {
					name: group.householdName,
					primaryContactId
				});
			} else {
				householdId = await ctx.db.insert('households', {
					orgId: args.orgId,
					name: group.householdName,
					primaryContactId
				});
			}
			householdCount++;

			for (let index = 0; index < contactIds.length; index++) {
				const contactId = contactIds[index];
				const role = group.members[index].householdRole;
				const link = await ctx.db
					.query('householdMembers')
					.withIndex('by_householdId_and_contactId', (q) =>
						q.eq('householdId', householdId).eq('contactId', contactId)
					)
					.unique();
				if (link) {
					await ctx.db.patch('householdMembers', link._id, { role });
				} else {
					await ctx.db.insert('householdMembers', {
						orgId: args.orgId,
						householdId,
						contactId,
						role,
						pending: false
					});
				}
				householdMemberCount++;
			}
		}

		return {
			contacts: contactCount,
			households: householdCount,
			householdMembers: householdMemberCount,
			projectMembers: projectMemberCount
		};
	}
});

// ---------------------------------------------------------------------------
// 8. seedSponsors — the reference's `pledges`, as projectMembers role 'sponsor'
// ---------------------------------------------------------------------------

export const seedSponsors = internalMutation({
	args: {
		orgId: v.string(),
		sponsors: v.array(
			v.object({
				remoteId: v.string(),
				firstName: v.string(),
				lastName: v.optional(v.string()),
				email: v.optional(v.string()),
				phone: v.optional(v.string()),
				organization: v.optional(v.string()),
				city: v.optional(v.string()),
				state: v.optional(v.string()),
				links: v.array(
					v.object({
						projectNumber: v.string(),
						status: v.union(v.literal('paid'), v.literal('committed'))
					})
				)
			})
		)
	},
	returns: v.object({ contacts: v.number(), projectMembers: v.number() }),
	handler: async (ctx, args) => {
		const campaign = await requireCampaign(ctx, args.orgId);
		let contactCount = 0;
		let projectMemberCount = 0;

		for (const sponsor of args.sponsors) {
			const existing = await findContactByRemoteId(ctx, args.orgId, sponsor.remoteId);
			let contactId: Id<'contacts'>;
			if (existing) {
				await ctx.db.patch('contacts', existing._id, {
					firstName: sponsor.firstName,
					lastName: sponsor.lastName,
					organization: sponsor.organization
				});
				contactId = existing._id;
			} else {
				contactId = await createContactModel(ctx, {
					orgId: args.orgId,
					firstName: sponsor.firstName,
					lastName: sponsor.lastName,
					email: sponsor.email,
					phone: sponsor.phone,
					organization: sponsor.organization,
					city: sponsor.city,
					state: sponsor.state,
					source: 'sponsor',
					updateDetail: 'summary',
					remoteId: sponsor.remoteId
				});
			}
			contactCount++;
			await ensureCampaignMembership(ctx, args.orgId, campaign._id, contactId, 'sponsor');

			for (const link of sponsor.links) {
				const project = await requireProjectByNumber(ctx, campaign._id, link.projectNumber);
				// The reference's pledge status lives on the link's attributes.
				await upsertProjectMember(ctx, args.orgId, project._id, contactId, 'sponsor', {
					status: link.status
				});
				projectMemberCount++;
			}
		}

		return { contacts: contactCount, projectMembers: projectMemberCount };
	}
});

// ---------------------------------------------------------------------------
// 9. seedMoney — transactions with their allocations, together
// ---------------------------------------------------------------------------

/**
 * Allocations travel with their transaction so a batch never has to refer to an
 * id minted by an earlier call. Two invariants Postgres held declaratively are
 * enforced here in code: `sum(allocations) <= transaction.amountCents`, and
 * `unique(transactionId, projectId)` for project-scoped allocations (multiple
 * project-less, campaign-level allocations per transaction remain legal).
 */
export const seedMoney = internalMutation({
	args: {
		orgId: v.string(),
		transactions: v.array(
			v.object({
				note: v.string(),
				type: transactionTypeValidator,
				amountCents: v.number(),
				occurredOn: v.optional(v.string()),
				method: v.optional(v.string()),
				reference: v.optional(v.string()),
				allocations: v.array(
					v.object({
						projectNumber: v.optional(v.string()),
						amountCents: v.number()
					})
				)
			})
		)
	},
	returns: v.object({
		inserted: v.number(),
		updated: v.number(),
		allocations: v.number()
	}),
	handler: async (ctx, args) => {
		const campaign = await requireCampaign(ctx, args.orgId);

		// One scan, reused for the whole batch: `transactions` has no index on
		// `note`, and the seeded set is small and bounded.
		const existingByNote = new Map<string, Doc<'transactions'>>();
		for (const row of await ctx.db
			.query('transactions')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.collect()) {
			if (row.note !== undefined && row.note.startsWith(SEED_TRANSACTION_NOTE_PREFIX)) {
				existingByNote.set(row.note, row);
			}
		}

		const projectIdByNumber = new Map<string, Id<'projects'>>();
		let inserted = 0;
		let updated = 0;
		let allocationCount = 0;

		for (const transaction of args.transactions) {
			assertIntegerCents(`${transaction.note} amountCents`, transaction.amountCents);

			let allocated = 0;
			const seenProjects = new Set<string>();
			for (const allocation of transaction.allocations) {
				assertIntegerCents(`${transaction.note} allocation`, allocation.amountCents);
				allocated += allocation.amountCents;
				if (allocation.projectNumber === undefined) continue;
				if (seenProjects.has(allocation.projectNumber)) {
					throw new ConvexError(
						`${transaction.note} is allocated twice to ${allocation.projectNumber}`
					);
				}
				seenProjects.add(allocation.projectNumber);
			}
			if (allocated > transaction.amountCents) {
				throw new ConvexError(
					`${transaction.note} over-allocated: ${allocated} > ${transaction.amountCents}`
				);
			}

			const fields = {
				type: transaction.type,
				amountCents: transaction.amountCents,
				occurredOn: transaction.occurredOn,
				method: transaction.method,
				reference: transaction.reference,
				note: transaction.note
			};

			const existing = existingByNote.get(transaction.note);
			let transactionId: Id<'transactions'>;
			if (existing) {
				transactionId = existing._id;
				await ctx.db.patch('transactions', transactionId, fields);
				// Allocations are rebuilt wholesale so a re-run converges rather than
				// accumulating.
				for (const stale of await ctx.db
					.query('allocations')
					.withIndex('by_transactionId', (q) => q.eq('transactionId', transactionId))
					.collect()) {
					await ctx.db.delete('allocations', stale._id);
				}
				updated++;
			} else {
				transactionId = await ctx.db.insert('transactions', { orgId: args.orgId, ...fields });
				inserted++;
			}

			for (const allocation of transaction.allocations) {
				let projectId: Id<'projects'> | undefined;
				if (allocation.projectNumber !== undefined) {
					const cached = projectIdByNumber.get(allocation.projectNumber);
					if (cached) {
						projectId = cached;
					} else {
						const project = await requireProjectByNumber(
							ctx,
							campaign._id,
							allocation.projectNumber
						);
						projectIdByNumber.set(allocation.projectNumber, project._id);
						projectId = project._id;
					}
				}
				await ctx.db.insert('allocations', {
					orgId: args.orgId,
					transactionId,
					campaignId: campaign._id,
					projectId,
					amountCents: allocation.amountCents
				});
				allocationCount++;
			}
		}

		return { inserted, updated, allocations: allocationCount };
	}
});

// ---------------------------------------------------------------------------
// 10. photos — family photos into Convex storage
// ---------------------------------------------------------------------------

/**
 * Internal twin of `projects/detail:generatePhotoUploadUrl`. That one is gated
 * on `getAccess` + `requireCapability`, and the seed runs through
 * `npx convex run` with no user identity, so it needs its own entry point.
 *
 * Returns a batch of single-use URLs: one CLI round trip per batch instead of
 * one per photo. The campaign lookup is a cheap guard that the caller is
 * pointed at a real, seeded org.
 */
export const generatePhotoUploadUrls = internalMutation({
	args: { orgId: v.string(), count: v.number() },
	returns: v.array(v.string()),
	handler: async (ctx, args) => {
		await requireCampaign(ctx, args.orgId);
		if (!Number.isInteger(args.count) || args.count < 1 || args.count > 64) {
			throw new ConvexError('count must be a whole number between 1 and 64');
		}
		const urls: string[] = [];
		for (let index = 0; index < args.count; index++) {
			urls.push(await ctx.storage.generateUploadUrl());
		}
		return urls;
	}
});

/**
 * Internal twin of `projects/detail:setProjectPhoto`, addressing projects by
 * `number` rather than by id. Deletes the blob it displaces — a reseed that
 * skipped this would leak one orphaned blob per project per run — and clears
 * `photoUrl`, so an upload and a pasted URL cannot both claim the hero image.
 */
export const setProjectPhotos = internalMutation({
	args: {
		orgId: v.string(),
		photos: v.array(
			v.object({
				projectNumber: v.string(),
				storageId: v.id('_storage')
			})
		)
	},
	returns: v.object({ updated: v.number(), replaced: v.number() }),
	handler: async (ctx, args) => {
		const campaign = await requireCampaign(ctx, args.orgId);
		let updated = 0;
		let replaced = 0;

		for (const photo of args.photos) {
			const project = await requireProjectByNumber(ctx, campaign._id, photo.projectNumber);
			if (project.photoStorageId && project.photoStorageId !== photo.storageId) {
				await ctx.storage.delete(project.photoStorageId);
				replaced++;
			}
			await ctx.db.patch('projects', project._id, {
				photoStorageId: photo.storageId,
				photoUrl: undefined
			});
			updated++;
		}

		return { updated, replaced };
	}
});

// ---------------------------------------------------------------------------
// 11. verify — row counts + the reconciliation assertion, read from the db
// ---------------------------------------------------------------------------

export const verify = internalQuery({
	args: {
		orgId: v.string(),
		expectedReceivedCents: v.number(),
		expectedSentCents: v.number(),
		expectedSpentCents: v.number()
	},
	returns: v.object({
		counts: v.record(v.string(), v.number()),
		reconciliation: v.object({
			receivedCents: v.number(),
			sentCents: v.number(),
			spentCents: v.number(),
			usBalanceCents: v.number(),
			pkBalanceCents: v.number()
		}),
		stageCounts: v.record(v.string(), v.number())
	}),
	handler: async (ctx, args) => {
		const campaign = await requireCampaign(ctx, args.orgId);

		const projects = await ctx.db
			.query('projects')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.collect();
		const projectIds = new Set<string>(projects.map((project) => project._id));

		const stageCounts: Record<string, number> = {};
		let projectsWithPhoto = 0;
		for (const project of projects) {
			stageCounts[project.stage] = (stageCounts[project.stage] ?? 0) + 1;
			if (project.photoStorageId) projectsWithPhoto++;
		}

		let budgets = 0;
		let documents = 0;
		let memberLinks = 0;
		let sponsorLinks = 0;
		for (const project of projects) {
			budgets += (
				await ctx.db
					.query('budgets')
					.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
					.collect()
			).length;
			documents += (
				await ctx.db
					.query('documents')
					.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
					.collect()
			).length;
			for (const link of await ctx.db
				.query('projectMembers')
				.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
				.collect()) {
				if (link.role === 'sponsor') sponsorLinks++;
				else memberLinks++;
			}
		}

		let memberContacts = 0;
		let sponsorContacts = 0;
		const seedContactIds = new Set<string>();
		for (const contact of await ctx.db
			.query('contacts')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.collect()) {
			if (contact.remoteId === undefined) continue;
			if (!contact.remoteId.startsWith(SEED_CONTACT_REMOTE_ID_PREFIX)) continue;
			seedContactIds.add(contact._id);
			if (contact.source === 'sponsor') sponsorContacts++;
			else memberContacts++;
		}

		let households = 0;
		let householdMembers = 0;
		for (const household of await ctx.db
			.query('households')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.collect()) {
			const links = await ctx.db
				.query('householdMembers')
				.withIndex('by_householdId', (q) => q.eq('householdId', household._id))
				.collect();
			if (!links.some((link) => seedContactIds.has(link.contactId))) continue;
			households++;
			householdMembers += links.length;
		}

		const seedTransactions = [];
		for (const row of await ctx.db
			.query('transactions')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.collect()) {
			if (row.note !== undefined && row.note.startsWith(SEED_TRANSACTION_NOTE_PREFIX)) {
				seedTransactions.push(row);
			}
		}
		const allocations = await ctx.db
			.query('allocations')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.collect();

		for (const allocation of allocations) {
			if (allocation.projectId !== undefined && !projectIds.has(allocation.projectId)) {
				throw new ConvexError(`Allocation ${allocation._id} points outside the campaign`);
			}
		}

		const totals = reconciliation(
			seedTransactions.map((row) => ({
				id: row._id,
				type: row.type,
				amountCents: row.amountCents
			})),
			allocations.map((row) => ({
				transactionId: row.transactionId,
				projectId: row.projectId ?? null,
				amountCents: row.amountCents
			}))
		);

		const diffs: Record<string, number> = {
			received: totals.receivedCents - args.expectedReceivedCents,
			sent: totals.sentCents - args.expectedSentCents,
			spent: totals.spentCents - args.expectedSpentCents
		};
		for (const key of Object.keys(diffs)) {
			if (Math.abs(diffs[key]) > 1) {
				throw new ConvexError(`Reconciliation mismatch on "${key}": off by ${diffs[key]} cents`);
			}
		}

		const stages = await ctx.db
			.query('pipelineStages')
			.withIndex('by_campaignId_and_order', (q) => q.eq('campaignId', campaign._id))
			.collect();
		const costTemplates = await ctx.db
			.query('costTemplates')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.collect();
		const taskTemplates = await ctx.db
			.query('taskTemplates')
			.withIndex('by_campaignId_and_version', (q) => q.eq('campaignId', campaign._id))
			.collect();
		const categories = await ctx.db
			.query('customFieldCategories')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.collect();
		const definitions = (
			await ctx.db
				.query('customFieldDefinitions')
				.withIndex('by_orgId_and_entity', (q) => q.eq('orgId', args.orgId).eq('entity', 'project'))
				.collect()
		).filter((row) => row.campaignId === campaign._id);
		const campaignMemberships = await ctx.db
			.query('campaignMemberships')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.collect();

		return {
			counts: {
				projects: projects.length,
				projectsWithPhoto,
				budgets,
				documents,
				memberContacts,
				sponsorContacts,
				households,
				householdMembers,
				projectMembersMember: memberLinks,
				projectMembersSponsor: sponsorLinks,
				campaignMemberships: campaignMemberships.length,
				pipelineStages: stages.length,
				costTemplates: costTemplates.length,
				taskTemplates: taskTemplates.length,
				customFieldCategories: categories.length,
				customFieldDefinitions: definitions.length,
				transactions: seedTransactions.length,
				donations: seedTransactions.filter((row) => row.type === 'donation').length,
				transfers: seedTransactions.filter((row) => row.type === 'transfer').length,
				expenditures: seedTransactions.filter((row) => row.type === 'expenditure').length,
				allocations: allocations.length
			},
			reconciliation: {
				receivedCents: totals.receivedCents,
				sentCents: totals.sentCents,
				spentCents: totals.spentCents,
				usBalanceCents: totals.usBalanceCents,
				pkBalanceCents: totals.pkBalanceCents
			},
			stageCounts
		};
	}
});
