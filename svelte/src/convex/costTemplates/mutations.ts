import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import { requireCapability } from '../model/access';

// Append-only: a rate-card change is a new version row, never an edit of an
// existing one, so budgets keep the version they snapshotted.
export const createCostTemplateVersion = mutation({
	args: {
		campaignId: v.id('campaigns'),
		version: v.string(),
		lineItems: v.record(v.string(), v.number()),
		effectiveFrom: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'money:write', args.campaignId);

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			throw new ConvexError('Campaign not found');
		}

		const conflict = await ctx.db
			.query('costTemplates')
			.withIndex('by_campaignId_and_version', (q) =>
				q.eq('campaignId', args.campaignId).eq('version', args.version)
			)
			.first();
		if (conflict) {
			throw new ConvexError('Cost template version already exists for this campaign');
		}

		for (const [key, amount] of Object.entries(args.lineItems)) {
			if (!Number.isInteger(amount)) {
				throw new ConvexError(`Line item "${key}" must be an integer number of cents`);
			}
		}

		return await ctx.db.insert('costTemplates', {
			orgId,
			campaignId: args.campaignId,
			version: args.version,
			effectiveFrom: args.effectiveFrom,
			lineItems: args.lineItems
		});
	}
});
