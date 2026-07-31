import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { createCampaignModel } from '../model/campaigns';
import { requireOrgId } from '../model/auth';
import { deleteCampaignCascade } from '../model/cascade';

const statusValidator = v.union(v.literal('active'), v.literal('paused'), v.literal('archived'));
const budgetShapeValidator = v.union(v.literal('flat'), v.literal('template'), v.literal('none'));
const goalTriggerValidator = v.union(v.literal('manual'), v.literal('stage'), v.literal('task'));

export const createCampaign = mutation({
	args: {
		name: v.string(),
		slug: v.string(),
		objectLabel: v.string(),
		objectLabelPlural: v.string(),
		goalLabel: v.string(),
		goalVerb: v.string(),
		status: v.optional(statusValidator),
		numberPrefix: v.optional(v.string()),
		theme: v.optional(v.string()),
		summary: v.optional(v.string()),
		story: v.optional(v.string()),
		coverImageUrl: v.optional(v.string()),
		iconUrl: v.optional(v.string()),
		promoVideoUrl: v.optional(v.string()),
		accent: v.optional(v.string()),
		membersEnabled: v.optional(v.boolean()),
		budgetShape: v.optional(budgetShapeValidator),
		goalTrigger: v.optional(goalTriggerValidator),
		isPublished: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		return await createCampaignModel(ctx, { ...args, orgId });
	}
});

// objectSlug is deliberately absent from these args — it is frozen at creation.
export const updateCampaign = mutation({
	args: {
		campaignId: v.id('campaigns'),
		name: v.optional(v.string()),
		slug: v.optional(v.string()),
		status: v.optional(statusValidator),
		numberPrefix: v.optional(v.string()),
		objectLabel: v.optional(v.string()),
		objectLabelPlural: v.optional(v.string()),
		theme: v.optional(v.string()),
		summary: v.optional(v.string()),
		story: v.optional(v.string()),
		coverImageUrl: v.optional(v.string()),
		iconUrl: v.optional(v.string()),
		promoVideoUrl: v.optional(v.string()),
		accent: v.optional(v.string()),
		membersEnabled: v.optional(v.boolean()),
		budgetShape: v.optional(budgetShapeValidator),
		goalLabel: v.optional(v.string()),
		goalVerb: v.optional(v.string()),
		goalTrigger: v.optional(goalTriggerValidator),
		isPublished: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			throw new ConvexError('Campaign not found');
		}

		const { campaignId, ...updates } = args;

		if (updates.slug !== undefined && updates.slug !== campaign.slug) {
			const conflict = await ctx.db
				.query('campaigns')
				.withIndex('by_orgId_and_slug', (q) => q.eq('orgId', orgId).eq('slug', updates.slug!))
				.first();
			if (conflict) {
				throw new ConvexError('Campaign slug already in use');
			}
		}

		const patch: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(updates)) {
			if (value !== undefined) {
				patch[key] = value;
			}
		}

		await ctx.db.patch('campaigns', campaignId, patch as Partial<Doc<'campaigns'>>);
		return campaignId;
	}
});

export const deleteCampaign = mutation({
	args: {
		campaignId: v.id('campaigns')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			throw new ConvexError('Campaign not found');
		}

		await deleteCampaignCascade(ctx, args.campaignId);
		return null;
	}
});
