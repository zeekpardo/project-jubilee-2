// ============================================================
// Authoring what a check-in asks, and what its update looks like
// ============================================================
// The write side of checkinTemplates and updateFormats. Both tables are
// append-only with one active row per (org, campaign), which is the
// promptVersions contract and is enforced here rather than in the schema for
// the same reason it is there: Convex has no partial unique index, so "exactly
// one active" is a mutation-layer invariant or it is nothing.
//
// NOTHING HERE EDITS A ROW'S CONTENT. `createTemplate` inserts a new version;
// there is no `updateTemplate`. A conversation names the version it resolved
// from and the decision trace is replayed against it (§5), so editing a live
// template in place would silently re-target every log that points at it.
// Activating is the only mutation of an existing row, and it changes which
// version NEW conversations start from — never what an old one asked.
// ============================================================

import { ConvexError, v } from 'convex/values';
import { mutation } from '../functions';
import { query } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { readableOrgId, requireCapability } from '../model/access';
import { DEFAULT_TEMPLATE, DEFAULT_UPDATE_FORMAT } from '../../lib/domain/checkin-templates';

/** The authored objective, as it is stored and as the editor submits it. */
const objectiveInput = v.object({
	key: v.string(),
	label: v.string(),
	description: v.string(),
	minRating: v.optional(v.number()),
	minConfidence: v.optional(v.number()),
	maxAttempts: v.optional(v.number()),
	skipIfKnown: v.optional(v.boolean()),
	capture: v.optional(
		v.union(
			v.object({ kind: v.literal('none') }),
			v.object({
				kind: v.literal('field'),
				entity: v.union(v.literal('project'), v.literal('contact')),
				fieldKey: v.string(),
				options: v.optional(v.array(v.string()))
			})
		)
	)
});

const stepInput = v.object({
	key: v.string(),
	title: v.string(),
	entryMessage: v.optional(v.string()),
	objectives: v.array(objectiveInput)
});

const sectionInput = v.object({
	key: v.string(),
	label: v.string(),
	guidance: v.string(),
	approxWords: v.optional(v.number())
});

/**
 * A key has to survive being a tool-schema property name and an objective key
 * in a judge prompt, so it is constrained to what is safe in both rather than
 * to what happens to work today.
 */
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,48}$/;

function assertKeys(keys: string[], what: string): void {
	const seen = new Set<string>();
	for (const key of keys) {
		if (!KEY_PATTERN.test(key)) {
			throw new ConvexError(
				`${what} key "${key}" must be lowercase letters, digits and underscores, starting with a letter.`
			);
		}
		if (seen.has(key)) {
			// Two objectives with one key would collide in `bestStates`, which is
			// keyed by it — the second would silently overwrite the first's state.
			throw new ConvexError(`Duplicate ${what} key: ${key}`);
		}
		seen.add(key);
	}
}

/** Deactivate whatever currently holds the active slot for this scope. */
async function clearActiveTemplate(
	ctx: MutationCtx,
	orgId: string,
	campaignId: Id<'campaigns'> | undefined,
	keep: Id<'checkinTemplates'>
): Promise<void> {
	const others = await ctx.db
		.query('checkinTemplates')
		.withIndex('by_orgId_and_campaignId_and_isActive', (q) =>
			q.eq('orgId', orgId).eq('campaignId', campaignId).eq('isActive', true)
		)
		.take(20);
	for (const other of others) {
		if (other._id === keep) continue;
		await ctx.db.patch('checkinTemplates', other._id, { isActive: false });
	}
}

export const listTemplates = query({
	args: { campaignId: v.optional(v.id('campaigns')) },
	handler: async (ctx, args) => {
		// `readableOrgId`, not `requireCapability`: a query runs on every
		// subscription tick, and an admin who loses the capability should watch
		// the panel empty rather than watch it fill with errors.
		const orgId = await readableOrgId(ctx, 'settings:manage');
		if (!orgId) return [];
		const rows = await ctx.db
			.query('checkinTemplates')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.take(100);
		// Filtered in JS rather than by index: the campaign-scoped and org-wide
		// rows are both wanted here (the editor shows the fallback alongside the
		// override), and that is a predicate no single index expresses.
		return rows.filter((row) => row.campaignId === args.campaignId || row.campaignId === undefined);
	}
});

export const listUpdateFormats = query({
	args: { campaignId: v.optional(v.id('campaigns')) },
	handler: async (ctx, args) => {
		// `readableOrgId`, not `requireCapability`: a query runs on every
		// subscription tick, and an admin who loses the capability should watch
		// the panel empty rather than watch it fill with errors.
		const orgId = await readableOrgId(ctx, 'settings:manage');
		if (!orgId) return [];
		const rows = await ctx.db
			.query('updateFormats')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.take(100);
		return rows.filter((row) => row.campaignId === args.campaignId || row.campaignId === undefined);
	}
});

export const createTemplate = mutation({
	args: {
		campaignId: v.optional(v.id('campaigns')),
		version: v.string(),
		name: v.string(),
		notes: v.optional(v.string()),
		steps: v.array(stepInput),
		activate: v.boolean()
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');

		const version = args.version.trim();
		if (!version) throw new ConvexError('A template needs a version.');

		const clash = await ctx.db
			.query('checkinTemplates')
			.withIndex('by_orgId_and_version', (q) => q.eq('orgId', orgId).eq('version', version))
			.first();
		if (clash) throw new ConvexError(`Version ${version} already exists.`);

		assertKeys(
			args.steps.map((step) => step.key),
			'Step'
		);
		assertKeys(
			args.steps.flatMap((step) => step.objectives.map((objective) => objective.key)),
			'Objective'
		);
		if (args.steps.every((step) => step.objectives.length === 0)) {
			// A template with nothing to ask resolves to an empty objective set, and
			// `decideNext` reads that as "everything answered" and drafts from a
			// conversation that never happened.
			throw new ConvexError('A template needs at least one objective.');
		}

		const templateId = await ctx.db.insert('checkinTemplates', {
			orgId,
			campaignId: args.campaignId,
			version,
			name: args.name.trim() || version,
			notes: args.notes,
			steps: args.steps,
			isActive: args.activate
		});

		if (args.activate) await clearActiveTemplate(ctx, orgId, args.campaignId, templateId);
		return templateId;
	}
});

export const activateTemplate = mutation({
	args: { templateId: v.id('checkinTemplates') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');
		const template = await ctx.db.get('checkinTemplates', args.templateId);
		if (!template || template.orgId !== orgId) throw new ConvexError('Template not found');

		await clearActiveTemplate(ctx, orgId, template.campaignId, template._id);
		// Open conversations keep the version they froze at open, exactly as they
		// do for prompts. Promoting a template changes what the NEXT check-in
		// asks, never what a family is halfway through answering.
		await ctx.db.patch('checkinTemplates', template._id, { isActive: true });
		return template._id;
	}
});

export const createUpdateFormat = mutation({
	args: {
		campaignId: v.optional(v.id('campaigns')),
		version: v.string(),
		name: v.string(),
		titleGuidance: v.string(),
		instructions: v.string(),
		sections: v.array(sectionInput),
		activate: v.boolean()
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');

		const version = args.version.trim();
		if (!version) throw new ConvexError('A format needs a version.');

		const clash = await ctx.db
			.query('updateFormats')
			.withIndex('by_orgId_and_version', (q) => q.eq('orgId', orgId).eq('version', version))
			.first();
		if (clash) throw new ConvexError(`Version ${version} already exists.`);

		assertKeys(
			args.sections.map((section) => section.key),
			'Section'
		);
		if (args.sections.length === 0) {
			// Every section is a required property on the generated tool. Zero
			// sections is a tool that asks for a title and nothing else.
			throw new ConvexError('A format needs at least one section.');
		}
		if (args.sections.some((section) => section.key === 'title')) {
			// `title` is the tool's own property. A section by that name would
			// overwrite it in the generated schema.
			throw new ConvexError('A section cannot be called "title".');
		}

		const formatId = await ctx.db.insert('updateFormats', {
			orgId,
			campaignId: args.campaignId,
			version,
			name: args.name.trim() || version,
			titleGuidance: args.titleGuidance,
			instructions: args.instructions,
			sections: args.sections,
			isActive: args.activate
		});

		if (args.activate) {
			const others = await ctx.db
				.query('updateFormats')
				.withIndex('by_orgId_and_campaignId_and_isActive', (q) =>
					q.eq('orgId', orgId).eq('campaignId', args.campaignId).eq('isActive', true)
				)
				.take(20);
			for (const other of others) {
				if (other._id === formatId) continue;
				await ctx.db.patch('updateFormats', other._id, { isActive: false });
			}
		}
		return formatId;
	}
});

export const activateUpdateFormat = mutation({
	args: { formatId: v.id('updateFormats') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');
		const format = await ctx.db.get('updateFormats', args.formatId);
		if (!format || format.orgId !== orgId) throw new ConvexError('Format not found');

		const others = await ctx.db
			.query('updateFormats')
			.withIndex('by_orgId_and_campaignId_and_isActive', (q) =>
				q.eq('orgId', orgId).eq('campaignId', format.campaignId).eq('isActive', true)
			)
			.take(20);
		for (const other of others) {
			if (other._id === format._id) continue;
			await ctx.db.patch('updateFormats', other._id, { isActive: false });
		}

		await ctx.db.patch('updateFormats', format._id, { isActive: true });
		return format._id;
	}
});

/**
 * Give an org the shipped default template and format, org-wide.
 *
 * Seeding does NOT activate over something already active, on the same rule
 * `seedPromptVersions` follows: promoting what a family is asked is a decision
 * a person makes, not a side effect of clicking a button labelled "seed".
 */
export const seedDefaults = mutation({
	args: {},
	handler: async (ctx) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');

		const existingTemplate = await ctx.db
			.query('checkinTemplates')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.first();
		const existingFormat = await ctx.db
			.query('updateFormats')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.first();

		const inserted: string[] = [];

		if (!existingTemplate) {
			await ctx.db.insert('checkinTemplates', {
				orgId,
				version: DEFAULT_TEMPLATE.version,
				name: DEFAULT_TEMPLATE.name,
				steps: DEFAULT_TEMPLATE.steps,
				isActive: true
			});
			inserted.push(DEFAULT_TEMPLATE.version);
		}

		if (!existingFormat) {
			await ctx.db.insert('updateFormats', {
				orgId,
				version: DEFAULT_UPDATE_FORMAT.version,
				name: DEFAULT_UPDATE_FORMAT.name,
				titleGuidance: DEFAULT_UPDATE_FORMAT.titleGuidance,
				instructions: DEFAULT_UPDATE_FORMAT.instructions,
				sections: DEFAULT_UPDATE_FORMAT.sections,
				isActive: true
			});
			inserted.push(DEFAULT_UPDATE_FORMAT.version);
		}

		return inserted;
	}
});
