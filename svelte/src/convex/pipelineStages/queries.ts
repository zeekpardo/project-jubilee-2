import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import { authComponent, createAuth } from '../auth';

async function activeOrgId(ctx: QueryCtx): Promise<string | null> {
	const user = await authComponent.safeGetAuthUser(ctx);
	if (!user) {
		return null;
	}

	try {
		const auth = createAuth(ctx);
		const organization = await auth.api.getFullOrganization({
			headers: await authComponent.getHeaders(ctx)
		});
		return organization?.id ?? null;
	} catch {
		return null;
	}
}

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
