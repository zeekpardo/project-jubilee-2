// The public read surface. See model/public.ts for the wall's full contract.
// These queries take NO auth: they are readable by an anonymous visitor, which
// is exactly why every one of them must go through the scrubbing helpers.

import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import {
	publicCampaignStats,
	publicFieldDefs,
	toPublicCampaign,
	toPublicCampaignSummary,
	toPublicOrgProfile,
	toPublicProject,
	type PublicCampaignSummary,
	type PublicOrgProfile,
	type PublicProject,
	type PublicStat
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
