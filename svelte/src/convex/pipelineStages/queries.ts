import { v } from 'convex/values';
import { query } from '../_generated/server';
import { activeOrgId } from '../model/auth';

export const listStages = query({
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
			.query('pipelineStages')
			.withIndex('by_campaignId_and_order', (q) => q.eq('campaignId', args.campaignId))
			.collect();
	}
});
