// The public read surface. See model/public.ts for the wall's full contract.
// These queries take NO auth: they are readable by an anonymous visitor, which
// is exactly why every one of them must go through the scrubbing helpers.

import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import {
	orgIdForSlug,
	publicCampaignStats,
	publicFieldDefs,
	toPublicCampaign,
	toPublicCampaignSummary,
	toPublicOrgProfile,
	toPublicProject,
	toPublicUpdate,
	type PublicCampaignSummary,
	type PublicOrgProfile,
	type PublicProject,
	type PublicStat,
	type PublicUpdate
} from '../model/public';
import { publicStatSections, type PublicStatSection } from '../model/stats';

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
	// `orgIdForSlug` is these same three lines, lifted into model/public.ts once
	// the signed-in site needed the identical lookup. Two copies of "which org is
	// this" drifting apart is how one org ends up shadowing another's site.
	const orgId = await orgIdForSlug(ctx, orgSlug);
	if (!orgId) return null;

	const campaign = await ctx.db
		.query('campaigns')
		.withIndex('by_orgId_and_slug', (q) => q.eq('orgId', orgId).eq('slug', campaignSlug))
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
		return campaign ? await toPublicCampaign(ctx, campaign) : null;
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
 * The campaign's own published posts, newest first. Campaign-level ONLY: an
 * update about one family belongs on that record's page, where the project's
 * own publish check applies to it — see listProjectUpdates below.
 *
 * Drafts cannot come out of here twice over. The index range asks for published
 * rows, and `toPublicUpdate` returns null for anything else, because a draft
 * reachable through the token-less public client would be a wall breach by
 * construction rather than a display bug.
 */
export const listCampaignUpdates = query({
	args: { orgSlug: v.string(), campaignSlug: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, args): Promise<PublicUpdate[]> => {
		const campaign = await resolvePublishedCampaign(ctx, args.orgSlug, args.campaignSlug);
		if (!campaign) return [];

		const updates = await ctx.db
			.query('updates')
			.withIndex('by_campaignId_and_status_and_publishedAt', (q) =>
				q.eq('campaignId', campaign._id).eq('status', 'published')
			)
			.order('desc')
			// Campaign-level means projectId ABSENT, which no index can express
			// alongside the campaign. Applied before the take, so a page is still
			// `limit` campaign-level posts rather than whatever survived a trim.
			.filter((q) => q.eq(q.field('projectId'), undefined))
			.take(clampLimit(args.limit));

		const out: PublicUpdate[] = [];
		for (const update of updates) {
			const publicUpdate = await toPublicUpdate(ctx, update);
			if (publicUpdate) out.push(publicUpdate);
		}
		return out;
	}
});

/**
 * Published posts about one record, newest first.
 *
 * The project's OWN publish check stays explicit, exactly as `getProject` keeps
 * it: the index this reads is scoped to the update's status and knows nothing
 * about the record. A published update on an unpublished project is not public
 * — nothing in this codebase treats a parent's state as authorization for a
 * child row, and here the child would be prose about the family.
 */
export const listProjectUpdates = query({
	args: {
		orgSlug: v.string(),
		campaignSlug: v.string(),
		number: v.string(),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args): Promise<PublicUpdate[]> => {
		const campaign = await resolvePublishedCampaign(ctx, args.orgSlug, args.campaignSlug);
		if (!campaign) return [];

		const project = await ctx.db
			.query('projects')
			.withIndex('by_campaignId_and_number', (q) =>
				q.eq('campaignId', campaign._id).eq('number', args.number)
			)
			.first();
		if (!project || !project.isPublished) return [];

		const updates = await ctx.db
			.query('updates')
			.withIndex('by_projectId_and_status_and_publishedAt', (q) =>
				q.eq('projectId', project._id).eq('status', 'published')
			)
			.order('desc')
			.take(clampLimit(args.limit));

		const out: PublicUpdate[] = [];
		for (const update of updates) {
			const publicUpdate = await toPublicUpdate(ctx, update);
			if (publicUpdate) out.push(publicUpdate);
		}
		return out;
	}
});

/**
 * The campaign's impact numbers, via the campaign-stats registry (see
 * publicCampaignStats for why these are safe to count across unpublished
 * projects too). Empty for an unknown or unpublished campaign — never null,
 * since the UI renders this as a list of tiles.
 */
export const getCampaignStats = query({
	args: { orgSlug: v.string(), campaignSlug: v.string() },
	handler: async (ctx, args): Promise<PublicStat[]> => {
		const campaign = await resolvePublishedCampaign(ctx, args.orgSlug, args.campaignSlug);
		if (!campaign) return [];
		return publicCampaignStats(ctx, campaign);
	}
});

/**
 * The org page's impact sections: one per campaign the admin selected, each
 * reusing that campaign's own public stat selection. Never a sum across
 * campaigns — see orgSettings.publicStatSections for why. Empty when the org
 * has selected none, or when every selection resolved to nothing publishable.
 */
export const getOrgStatSections = query({
	args: { orgSlug: v.string() },
	handler: async (ctx, args): Promise<PublicStatSection[]> => {
		const settings = await ctx.db
			.query('orgSettings')
			.withIndex('by_slug', (q) => q.eq('slug', args.orgSlug))
			.first();
		if (!settings) return [];
		return publicStatSections(ctx, settings);
	}
});

/**
 * Public-site chrome for an org: header wordmark, tagline, theme. Null for an
 * unknown slug so the caller can 404 rather than render an empty header.
 */
export const getOrgProfile = query({
	args: { orgSlug: v.string() },
	handler: async (ctx, args): Promise<PublicOrgProfile | null> => {
		const settings = await ctx.db
			.query('orgSettings')
			.withIndex('by_slug', (q) => q.eq('slug', args.orgSlug))
			.first();
		if (!settings) return null;

		let fallbackName = '';
		if (!settings.publicName?.trim()) {
			// Oldest published campaign first (ascending is this index's default
			// order), matching the reference app's "site falls back to the
			// campaign name" behavior for an org that hasn't set its own chrome.
			const campaign = await ctx.db
				.query('campaigns')
				.withIndex('by_orgId', (q) => q.eq('orgId', settings.orgId))
				.filter((q) => q.eq(q.field('isPublished'), true))
				.first();
			fallbackName = campaign?.name ?? '';
		}

		return toPublicOrgProfile(settings, args.orgSlug, fallbackName);
	}
});

/** Published campaigns for an org's site nav / campaign picker. */
export const listCampaigns = query({
	args: { orgSlug: v.string() },
	handler: async (ctx, args): Promise<PublicCampaignSummary[]> => {
		const settings = await ctx.db
			.query('orgSettings')
			.withIndex('by_slug', (q) => q.eq('slug', args.orgSlug))
			.first();
		if (!settings) return [];

		const campaigns = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId', (q) => q.eq('orgId', settings.orgId))
			.filter((q) => q.eq(q.field('isPublished'), true))
			.collect();

		return await Promise.all(campaigns.map((campaign) => toPublicCampaignSummary(ctx, campaign)));
	}
});
