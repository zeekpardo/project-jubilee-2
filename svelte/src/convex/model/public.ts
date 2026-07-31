// ============================================================
// THE PRIVACY WALL
// ============================================================
// This module and `convex/public/queries.ts` are the ONLY data source
// public-facing pages may read from. Everything returned here is safe to
// render to an anonymous visitor. Public pages must NEVER call the admin
// queries under campaigns/, projects/, contacts/, money/ and so on — those
// return unscrubbed admin records.
//
// The wall is an ALLOWLIST. Every returned object is built field by field
// below; no database document is ever spread into a response. Adding a field
// here is a privacy decision, not a refactor.
//
//   EXPOSED, and nothing else:
//   - project `number` (the public identifier)
//   - `publicName`, if an admin set one. Never derived from the real name:
//     no rule separates given name from surname across cultures. Null
//     otherwise, leaving `number` as the only identifier.
//   - story, photoUrl, videoUrl, stage key and label
//   - memberCount (a COUNT, never the member rows)
//   - memberFirstNames — only members given an explicit public first name;
//     the rest are counted but unnamed
//   - custom attributes whose field definition is explicitly isPublic
//   - isGoalMet and the campaign's goalLabel (the "Freed" badge)
//   - raised / target / progress, derived from the ledger. targetCents is
//     derived from the bonded debt owed for this family, so it quantifies
//     their bondage; it is exposed because it IS the fundraising ask.
//
//   NEVER EXPOSED. Do not add without a privacy review:
//   - siteRef — the internal factory/site reference. This app serves people
//     escaping forced labour; leaking where they were held can endanger them.
//   - whatsappPhone, managedMissionsLink, note — internal operations data
//   - member surnames, ages, relationships, or contact records of any kind
//   - donor/contact PII, donation amounts, or donor-to-project links
//   - Convex document ids — projects are addressed by `number` only
//
// Only projects with isPublished true are visible. Publishing is an
// independent toggle, decoupled from pipeline stage: an unpublished project
// does not exist as far as the public site is concerned.
// ============================================================

import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import {
	resolveFieldDefinitions,
	publicAttributes,
	type FieldDefinition
} from '../../lib/domain/field-definitions';
import { raisedForProject } from '../../lib/domain/reconciliation';

/**
 * Public names are ADMIN-ENTERED, never derived. Taking the first token of a
 * name leaks the surname for "Bhatti, Ahmed", for every name written without a
 * separator, and for every surname-first culture. There is no rule that works
 * across cultures, so an unset public name yields null and the project is
 * identified by its number alone.
 */
function publicNameOf(explicit: string | undefined): string | null {
	const trimmed = explicit?.trim();
	return trimmed ? trimmed : null;
}

export type PublicProject = {
	number: string;
	/** Null unless an admin set an explicit public name. */
	name: string | null;
	story: string | null;
	photoUrl: string | null;
	videoUrl: string | null;
	stage: string;
	stageLabel: string;
	isGoalMet: boolean;
	goalLabel: string;
	memberCount: number;
	memberFirstNames: string[];
	attributes: Record<string, unknown>;
	raisedCents: number;
	targetCents: number | null;
	progress: number | null;
};

export async function publicFieldDefs(
	ctx: QueryCtx,
	orgId: string,
	campaignId: Id<'campaigns'>
): Promise<FieldDefinition[]> {
	const rows = await ctx.db
		.query('customFieldDefinitions')
		.withIndex('by_orgId_and_entity', (q) => q.eq('orgId', orgId).eq('entity', 'project'))
		.collect();

	// Fail closed on a malformed row rather than trusting the write path: an
	// org-scope row must carry no campaignId, a campaign-scope row must carry
	// one. A mislabelled row would otherwise apply to every campaign.
	const wellFormed = rows.filter((row) =>
		row.scope === 'org' ? row.campaignId === undefined : row.campaignId !== undefined
	);

	const defs: FieldDefinition[] = wellFormed.map((row) => ({
		id: row._id,
		entity: row.entity,
		scope: row.scope,
		campaignId: row.campaignId ?? null,
		categoryId: row.categoryId ?? null,
		key: row.key,
		label: row.label,
		type: row.type,
		options: row.options ?? null,
		order: row.order,
		isPublic: row.isPublic,
		isRequired: row.isRequired
	}));

	return resolveFieldDefinitions(defs, 'project', campaignId);
}

/** Donation cents attributed to this project, via the ported ledger math. */
async function raisedCentsFor(ctx: QueryCtx, projectId: Id<'projects'>): Promise<number> {
	const allocations = await ctx.db
		.query('allocations')
		.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
		.collect();
	if (allocations.length === 0) return 0;

	const transactions = [];
	const seen = new Set<string>();
	for (const allocation of allocations) {
		if (seen.has(allocation.transactionId)) continue;
		seen.add(allocation.transactionId);
		const transaction = await ctx.db.get('transactions', allocation.transactionId);
		if (transaction) {
			transactions.push({
				id: transaction._id as string,
				type: transaction.type,
				amountCents: transaction.amountCents
			});
		}
	}

	return raisedForProject(
		projectId,
		transactions,
		allocations.map((a) => ({
			transactionId: a.transactionId as string,
			projectId: a.projectId ?? null,
			amountCents: a.amountCents
		}))
	);
}

/**
 * Build the public view of a project. Every field is copied explicitly; the
 * source document is never spread, so a new admin-only column cannot leak by
 * simply existing.
 */
export async function toPublicProject(
	ctx: QueryCtx,
	project: Doc<'projects'>,
	campaign: Doc<'campaigns'>,
	presolvedDefs?: FieldDefinition[]
): Promise<PublicProject> {
	const stage = await ctx.db
		.query('pipelineStages')
		.withIndex('by_campaignId_and_key', (q) =>
			q.eq('campaignId', project.campaignId).eq('key', project.stage)
		)
		.first();

	const memberLinks = await ctx.db
		.query('projectMembers')
		.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
		.collect();

	// Only members with an explicit public first name are listed. A member
	// without one is counted, never named.
	const memberFirstNames: string[] = [];
	for (const link of memberLinks) {
		const contact = await ctx.db.get('contacts', link.contactId);
		const publicFirst = publicNameOf(contact?.publicFirstName);
		if (publicFirst) memberFirstNames.push(publicFirst);
	}

	const budget = await ctx.db
		.query('budgets')
		.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
		.first();

	const raisedCents = await raisedCentsFor(ctx, project._id);
	const targetCents = budget?.targetCents ?? null;

	const defs = presolvedDefs ?? (await publicFieldDefs(ctx, project.orgId, project.campaignId));

	return {
		number: project.number,
		name: publicNameOf(project.publicName),
		story: project.story ?? null,
		photoUrl: project.photoUrl ?? null,
		videoUrl: project.videoUrl ?? null,
		stage: project.stage,
		stageLabel: stage?.label ?? project.stage,
		isGoalMet: project.isGoalMet,
		goalLabel: campaign.goalLabel,
		memberCount: memberLinks.length,
		memberFirstNames,
		attributes: publicAttributes(defs, project.attributes),
		raisedCents,
		targetCents,
		progress: targetCents && targetCents > 0 ? Math.min(1, raisedCents / targetCents) : null
	};
}

export type PublicCampaign = {
	slug: string;
	name: string;
	summary: string | null;
	story: string | null;
	coverImageUrl: string | null;
	iconUrl: string | null;
	promoVideoUrl: string | null;
	accent: string | null;
	theme: string | null;
	objectLabel: string;
	objectLabelPlural: string;
	objectSlug: string;
	goalLabel: string;
	goalVerb: string;
};

/** Public view of a campaign. Built field by field, same rule as projects. */
export function toPublicCampaign(campaign: Doc<'campaigns'>): PublicCampaign {
	return {
		slug: campaign.slug,
		name: campaign.name,
		summary: campaign.summary ?? null,
		story: campaign.story ?? null,
		coverImageUrl: campaign.coverImageUrl ?? null,
		iconUrl: campaign.iconUrl ?? null,
		promoVideoUrl: campaign.promoVideoUrl ?? null,
		accent: campaign.accent ?? null,
		theme: campaign.theme ?? null,
		objectLabel: campaign.objectLabel,
		objectLabelPlural: campaign.objectLabelPlural,
		objectSlug: campaign.objectSlug,
		goalLabel: campaign.goalLabel,
		goalVerb: campaign.goalVerb
	};
}
