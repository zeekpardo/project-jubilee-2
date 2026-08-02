import { v } from 'convex/values';
import { query } from '../_generated/server';
import { readableOrgId } from '../model/access';

export const listStages = query({
	args: {
		campaignId: v.id('campaigns')
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'projects:read', args.campaignId);
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
