import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAccess, readableOrgId } from '../model/access';
import { can } from '../../lib/domain/permissions';

export const listCostTemplates = query({
	args: {
		campaignId: v.id('campaigns')
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'money:read', args.campaignId);
		if (!orgId) {
			return [];
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return [];
		}

		return await ctx.db
			.query('costTemplates')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.order('desc')
			.collect();
	}
});

export const getCostTemplate = query({
	args: {
		costTemplateId: v.id('costTemplates')
	},
	handler: async (ctx, args) => {
		// The campaign is only knowable once the row is loaded, so this gates
		// twice: org membership first, then the template's own campaignId.
		const access = await getAccess(ctx);
		if (!access.orgId) {
			return null;
		}

		const costTemplate = await ctx.db.get('costTemplates', args.costTemplateId);
		if (!costTemplate || costTemplate.orgId !== access.orgId) {
			return null;
		}
		if (!can(access, 'money:read', costTemplate.campaignId)) {
			return null;
		}

		return costTemplate;
	}
});

// Append-only table, so the newest row is the current rate card.
export const getLatestCostTemplate = query({
	args: {
		campaignId: v.id('campaigns')
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'money:read', args.campaignId);
		if (!orgId) {
			return null;
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return null;
		}

		return await ctx.db
			.query('costTemplates')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.order('desc')
			.first();
	}
});
