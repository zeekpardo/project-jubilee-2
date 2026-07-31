import { v } from 'convex/values';
import { query } from '../_generated/server';
import { activeOrgId } from '../model/auth';

export const listTaskTemplates = query({
	args: {
		campaignId: v.id('campaigns')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return [];
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return [];
		}

		return await ctx.db
			.query('taskTemplates')
			.withIndex('by_campaignId_and_isActive', (q) => q.eq('campaignId', args.campaignId))
			.collect();
	}
});

export const getActiveTaskTemplate = query({
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

		return await ctx.db
			.query('taskTemplates')
			.withIndex('by_campaignId_and_isActive', (q) =>
				q.eq('campaignId', args.campaignId).eq('isActive', true)
			)
			.unique();
	}
});
