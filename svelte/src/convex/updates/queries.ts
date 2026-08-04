// ============================================================
// Reading updates in the admin app
// ============================================================
// These return DRAFTS AND PUBLISHED POSTS, which is the whole difference
// between this module and the two queries in `public/queries.ts`. A draft is an
// admin row: it exists so someone can write before anyone decides the writing
// goes out. Nothing here may ever be called from a public page — see
// model/public.ts for the wall's contract.
//
// Reading is `projects:read`, scoped to the campaign the rows belong to. That
// is deliberately wider than the capability needed to write one and wider still
// than `content:publish`: a team leader must be able to read the draft they are
// writing, and see what was published about the family they work with.
//
// Every read is gated with `readableOrgId`, so a viewer who lost access sees an
// empty page rather than an error, and every read is `.take()`-bounded.
// ============================================================

import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { readableOrgId } from '../model/access';
import { clampUpdateLimit, listUpdatesByParent, resolveUpdateAssets } from '../model/updates';

/**
 * An update as the authoring screens need it: the row, plus its photographs
 * resolved to URLs so the editor can render the post it is editing.
 *
 * Resolving for a DRAFT is safe here and only here — this surface is
 * capability-gated, whereas the public projection resolves nothing until the
 * row is published, because a URL handed to an anonymous visitor can never be
 * taken back.
 */
export type AdminUpdate = Doc<'updates'> & { assets: Record<string, string> };

async function withAssets(ctx: QueryCtx, updates: Doc<'updates'>[]): Promise<AdminUpdate[]> {
	const out: AdminUpdate[] = [];
	for (const update of updates) {
		out.push({ ...update, assets: await resolveUpdateAssets(ctx, update.assetIds) });
	}
	return out;
}

/**
 * The campaign's own posts — campaign-level only, the same set the public
 * campaign feed draws from. A project's posts are that record's, and are read
 * by `listUpdatesForProject` below.
 */
export const listUpdatesForCampaign = query({
	args: { campaignId: v.id('campaigns'), limit: v.optional(v.number()) },
	handler: async (ctx, args): Promise<AdminUpdate[]> => {
		const orgId = await readableOrgId(ctx, 'projects:read', args.campaignId);
		if (!orgId) return [];

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) return [];

		return withAssets(
			ctx,
			await listUpdatesByParent(
				ctx,
				{ campaignId: args.campaignId, campaignLevelOnly: true },
				clampUpdateLimit(args.limit)
			)
		);
	}
});

/** Everything written about one record. */
export const listUpdatesForProject = query({
	args: { projectId: v.id('projects'), limit: v.optional(v.number()) },
	handler: async (ctx, args): Promise<AdminUpdate[]> => {
		// The campaign is only knowable after the project is read, so the org-wide
		// gate comes first and the campaign-scoped one straight after.
		const orgId = await readableOrgId(ctx, 'projects:read');
		if (!orgId) return [];

		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== orgId) return [];
		if (!(await readableOrgId(ctx, 'projects:read', project.campaignId))) return [];

		return withAssets(
			ctx,
			await listUpdatesByParent(ctx, { projectId: args.projectId }, clampUpdateLimit(args.limit))
		);
	}
});

/** One post, for the editor. Null when the caller may not read its campaign. */
export const getUpdate = query({
	args: { updateId: v.id('updates') },
	handler: async (ctx, args): Promise<AdminUpdate | null> => {
		const orgId = await readableOrgId(ctx, 'projects:read');
		if (!orgId) return null;

		const update = await ctx.db.get('updates', args.updateId);
		if (!update || update.orgId !== orgId) return null;
		if (!(await readableOrgId(ctx, 'projects:read', update.campaignId))) return null;

		return { ...update, assets: await resolveUpdateAssets(ctx, update.assetIds) };
	}
});
