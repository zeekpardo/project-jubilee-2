// The public read surface. See model/public.ts for the wall's full contract.
// These queries take NO auth: they are readable by an anonymous visitor, which
// is exactly why every one of them must go through the scrubbing helpers.

import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import {
	publicFieldDefs,
	toPublicCampaign,
	toPublicProject,
	type PublicProject
} from '../model/public';

/**
 * Campaign slugs are unique per ORG, not globally, so the public surface must
 * name the org too. orgSettings.slug is the globally unique handle. Resolving
 * a campaign by slug alone would let one org shadow or suppress another's
 * public site.
 */
async function resolvePublishedCampaign(
	ctx: QueryCtx,
	orgSlug: string,
	campaignSlug: string
): Promise<Doc<'campaigns'> | null> {
	const settings = await ctx.db
		.query('orgSettings')
		.withIndex('by_slug', (q) => q.eq('slug', orgSlug))
		.first();
	if (!settings) return null;

	const campaign = await ctx.db
		.query('campaigns')
		.withIndex('by_orgId_and_slug', (q) => q.eq('orgId', settings.orgId).eq('slug', campaignSlug))
		.first();
	if (!campaign || !campaign.isPublished) return null;
	return campaign;
}

const MAX_LIMIT = 100;
const clampLimit = (limit: number | undefined) =>
	Math.max(1, Math.min(Math.floor(limit ?? 50), MAX_LIMIT));

/** A published campaign, addressed by slug. Null when unpublished. */
export const getCampaign = query({
	args: { orgSlug: v.string(), slug: v.string() },
	handler: async (ctx, args) => {
		const campaign = await resolvePublishedCampaign(ctx, args.orgSlug, args.slug);
		return campaign ? toPublicCampaign(campaign) : null;
	}
});

/** Published projects in a published campaign. */
export const listProjects = query({
	args: { orgSlug: v.string(), campaignSlug: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, args): Promise<PublicProject[]> => {
		const campaign = await resolvePublishedCampaign(ctx, args.orgSlug, args.campaignSlug);
		if (!campaign) return [];

		const projects = await ctx.db
			.query('projects')
			.withIndex('by_campaignId_and_isPublished', (q) =>
				q.eq('campaignId', campaign._id).eq('isPublished', true)
			)
			.take(clampLimit(args.limit));

		// Resolved once for the whole page rather than per project.
		const defs = await publicFieldDefs(ctx, campaign.orgId, campaign._id);

		const out: PublicProject[] = [];
		for (const project of projects) {
			out.push(await toPublicProject(ctx, project, campaign, defs));
		}
		return out;
	}
});

/** One published project, addressed by its public number. */
export const getProject = query({
	args: { orgSlug: v.string(), campaignSlug: v.string(), number: v.string() },
	handler: async (ctx, args): Promise<PublicProject | null> => {
		const campaign = await resolvePublishedCampaign(ctx, args.orgSlug, args.campaignSlug);
		if (!campaign) return null;

		const project = await ctx.db
			.query('projects')
			.withIndex('by_campaignId_and_number', (q) =>
				q.eq('campaignId', campaign._id).eq('number', args.number)
			)
			.first();
		// The publish check stays explicit: the index above is not scoped to it.
		if (!project || !project.isPublished) return null;

		return toPublicProject(ctx, project, campaign);
	}
});

/**
 * Aggregate impact counts for a published campaign. Whole numbers only, with
 * no per-project or per-donor detail, and total raised rounded DOWN to the
 * nearest $1,000 so an individual gift can never be inferred from a change.
 */
export const getCampaignStats = query({
	args: { orgSlug: v.string(), campaignSlug: v.string() },
	handler: async (ctx, args) => {
		const campaign = await resolvePublishedCampaign(ctx, args.orgSlug, args.campaignSlug);
		if (!campaign) return null;

		// PUBLISHED projects only. Counting hidden ones would publish the
		// existence, size and outcome of an unpublished case — and because these
		// queries are live subscriptions, it would push a timestamped signal the
		// moment a family is enrolled or freed.
		const projects = await ctx.db
			.query('projects')
			.withIndex('by_campaignId_and_isPublished', (q) =>
				q.eq('campaignId', campaign._id).eq('isPublished', true)
			)
			.collect();

		let goalMetCount = 0;
		let peopleCount = 0;
		for (const project of projects) {
			if (project.isGoalMet) goalMetCount++;
			const members = await ctx.db
				.query('projectMembers')
				.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
				.collect();
			peopleCount += members.length;
		}

		const allocations = await ctx.db
			.query('allocations')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.collect();

		let raisedCents = 0;
		const seen = new Map<string, boolean>();
		for (const allocation of allocations) {
			let isDonation = seen.get(allocation.transactionId);
			if (isDonation === undefined) {
				const transaction = await ctx.db.get('transactions', allocation.transactionId);
				isDonation = transaction?.type === 'donation';
				seen.set(allocation.transactionId, isDonation);
			}
			if (isDonation) raisedCents += allocation.amountCents;
		}

		const ROUND_TO_CENTS = 100_000;

		return {
			projectCount: projects.length,
			goalMetCount,
			peopleCount,
			goalLabel: campaign.goalLabel,
			goalVerb: campaign.goalVerb,
			raisedCentsRounded: Math.floor(raisedCents / ROUND_TO_CENTS) * ROUND_TO_CENTS
		};
	}
});
