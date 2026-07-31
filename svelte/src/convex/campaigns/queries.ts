import { v } from 'convex/values';
import { query } from '../_generated/server';
import { activeOrgId } from '../model/auth';

export const listCampaigns = query({
	args: {},
	handler: async (ctx) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return [];
		}

		return await ctx.db
			.query('campaigns')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.collect();
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

		return campaign;
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

		return await ctx.db
			.query('campaigns')
			.withIndex('by_orgId_and_slug', (q) => q.eq('orgId', orgId).eq('slug', args.slug))
			.unique();
	}
});
