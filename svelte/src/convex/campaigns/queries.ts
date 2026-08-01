import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { activeOrgId } from '../model/auth';

/**
 * An uploaded cover/icon is reachable only through a signed URL, so a
 * storage id is resolved to one here. A pasted `coverImageUrl`/`iconUrl` is
 * already a URL and passes through untouched; it is also the fallback if
 * signing ever fails. Mirrors `projects/queries.ts`'s `withPhotoUrls`.
 */
async function withImageUrls(ctx: QueryCtx, row: Doc<'campaigns'>): Promise<Doc<'campaigns'>> {
	let next = row;
	if (row.coverImageStorageId) {
		const url = await ctx.storage.getUrl(row.coverImageStorageId);
		if (url) next = { ...next, coverImageUrl: url };
	}
	if (row.iconStorageId) {
		const url = await ctx.storage.getUrl(row.iconStorageId);
		if (url) next = { ...next, iconUrl: url };
	}
	return next;
}

export const listCampaigns = query({
	args: {},
	handler: async (ctx) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return [];
		}

		const rows = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.collect();
		return await Promise.all(rows.map((row) => withImageUrls(ctx, row)));
	}
});

export const getCampaign = query({
	args: {
		campaignId: v.id('campaigns')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return null;
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return null;
		}

		return await withImageUrls(ctx, campaign);
	}
});

export const getCampaignBySlug = query({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return null;
		}

		const campaign = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId_and_slug', (q) => q.eq('orgId', orgId).eq('slug', args.slug))
			.unique();
		return campaign ? await withImageUrls(ctx, campaign) : null;
	}
});
