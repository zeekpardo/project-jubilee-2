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
import { updateBySlug } from '../model/updates';
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

/**
 * PAGING AN UPDATE FEED. `publishedBefore` is a keyset cursor, not an offset:
 * the caller passes the `publishedAt` of the last post it received and gets the
 * next page of strictly older ones. An offset would be wrong rather than merely
 * slow, because publishing one more post while a reader is on page two shifts
 * every later row down by one and duplicates a post across the boundary.
 *
 * Both feeds read an EXACT index range — no post-index filter — so a page
 * shorter than `limit` really is the end of the feed and a caller can stop
 * there. Ordering is `.order('desc')` over `publishedAt` with `_creationTime`
 * appended by Convex as the final key, so the newest post leads and no JS sort
 * is involved.
 *
 * The one gap: the cursor is exclusive on `publishedAt` alone, since an index
 * range cannot express "older than this millisecond, or the same millisecond but
 * created earlier". Two posts sharing one millisecond and straddling a page
 * boundary would cost the second of them its place in the feed. `publishedAt` is
 * stamped per mutation from the caller's clock, so that needs two publishes
 * inside the same millisecond; a bulk backfill that stamps a whole batch with
 * one timestamp is the case that would actually hit it.
 */
const publishedBeforeArg = v.optional(v.number());

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
	args: {
		orgSlug: v.string(),
		campaignSlug: v.string(),
		limit: v.optional(v.number()),
		publishedBefore: publishedBeforeArg
	},
	handler: async (ctx, args): Promise<PublicUpdate[]> => {
		const campaign = await resolvePublishedCampaign(ctx, args.orgSlug, args.campaignSlug);
		if (!campaign) return [];

		const updates = await ctx.db
			.query('updates')
			// Campaign-level means projectId ABSENT, and this index carries it, so
			// the range is exact: no filter, and a short page is genuinely the end of
			// the feed rather than a page the filter happened to thin out.
			.withIndex('by_campaignId_and_projectId_and_status_and_publishedAt', (q) => {
				const level = q
					.eq('campaignId', campaign._id)
					.eq('projectId', undefined)
					.eq('status', 'published');
				return args.publishedBefore === undefined
					? level
					: level.lt('publishedAt', args.publishedBefore);
			})
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
		limit: v.optional(v.number()),
		publishedBefore: publishedBeforeArg
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
			.withIndex('by_projectId_and_status_and_publishedAt', (q) => {
				const level = q.eq('projectId', project._id).eq('status', 'published');
				return args.publishedBefore === undefined
					? level
					: level.lt('publishedAt', args.publishedBefore);
			})
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
 * One campaign-level post at its permalink. This is what makes an update
 * addressable as a blog page, and it is addressed by slug because ids do not
 * travel — see the wall's header for why a slug may go out where an id may not.
 *
 * Campaign-level ONLY. `updateBySlug` pins the level in the index key, so a post
 * about one family cannot be reached here even by someone who knows its slug;
 * that one lives behind the record's own publish check in getProjectUpdate.
 *
 * Null for an unknown slug and null for an unpublished post, deliberately the
 * same answer: a caller can 404 both without the 404 telling anyone which of the
 * two it was. `toPublicUpdate` is what makes the second half true — the row is
 * loaded unscrubbed and only the wall decides whether it is public.
 */
export const getCampaignUpdate = query({
	args: { orgSlug: v.string(), campaignSlug: v.string(), updateSlug: v.string() },
	handler: async (ctx, args): Promise<PublicUpdate | null> => {
		const campaign = await resolvePublishedCampaign(ctx, args.orgSlug, args.campaignSlug);
		if (!campaign) return null;

		const update = await updateBySlug(ctx, campaign._id, undefined, args.updateSlug);
		return update ? await toPublicUpdate(ctx, update) : null;
	}
});

/**
 * One post about one record, at its permalink under that record's number.
 *
 * The project's OWN publish check stays explicit, exactly as `getProject` keeps
 * it: nothing in this codebase treats a parent's state as authorization for a
 * child row, and unpublishing a record must take its posts about that family off
 * the public site with it. The update's own publish check then happens again in
 * `toPublicUpdate`.
 *
 * A campaign-level post is not reachable from here: the slug is resolved with
 * this project's id pinned in the index key, so org-wide news cannot surface at
 * a named family's address.
 */
export const getProjectUpdate = query({
	args: {
		orgSlug: v.string(),
		campaignSlug: v.string(),
		number: v.string(),
		updateSlug: v.string()
	},
	handler: async (ctx, args): Promise<PublicUpdate | null> => {
		const campaign = await resolvePublishedCampaign(ctx, args.orgSlug, args.campaignSlug);
		if (!campaign) return null;

		const project = await ctx.db
			.query('projects')
			.withIndex('by_campaignId_and_number', (q) =>
				q.eq('campaignId', campaign._id).eq('number', args.number)
			)
			.first();
		if (!project || !project.isPublished) return null;

		const update = await updateBySlug(ctx, campaign._id, project._id, args.updateSlug);
		return update ? await toPublicUpdate(ctx, update) : null;
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
