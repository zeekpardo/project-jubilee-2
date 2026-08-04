import { ConvexError, v } from 'convex/values';
import { mutation } from '../functions';
import type { Doc } from '../_generated/dataModel';
import { createCampaignModel } from '../model/campaigns';
import { requireCapability } from '../model/access';
import { deleteCampaignCascade } from '../model/cascade';
import { statConfigsError, type StatConfig } from '../../lib/domain/campaign-stats';
import { loadPublicPolicy } from '../model/policy';

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
		const { orgId } = await requireCapability(ctx, 'campaign:create');
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
		const { orgId } = await requireCapability(ctx, 'campaign:edit');

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			throw new ConvexError('Campaign not found');
		}
		await requireCapability(ctx, 'campaign:edit', campaign._id);

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

		// A pasted URL supersedes an uploaded blob — the same invariant
		// setCampaignImage enforces in the other direction. Delete the blob it
		// displaces here too, or the upload leaks.
		if (patch.coverImageUrl !== undefined && campaign.coverImageStorageId) {
			await ctx.storage.delete(campaign.coverImageStorageId);
			patch.coverImageStorageId = undefined;
		}
		if (patch.iconUrl !== undefined && campaign.iconStorageId) {
			await ctx.storage.delete(campaign.iconStorageId);
			patch.iconStorageId = undefined;
		}

		await ctx.db.patch('campaigns', campaignId, patch as Partial<Doc<'campaigns'>>);
		return campaignId;
	}
});

const statSourceValidator = v.union(
	v.object({ kind: v.literal('builtin'), metric: v.string() }),
	v.object({
		kind: v.literal('field'),
		fieldKey: v.string(),
		aggregate: v.union(v.literal('sum'), v.literal('count'), v.literal('countWhere')),
		matchValue: v.optional(v.string())
	}),
	v.object({ kind: v.literal('task'), impactTag: v.string() }),
	v.object({
		kind: v.literal('member'),
		among: v.union(
			v.object({ kind: v.literal('all') }),
			v.object({ kind: v.literal('goalMet') }),
			v.object({ kind: v.literal('task'), impactTag: v.string() })
		),
		filter: v.optional(
			v.union(
				v.object({ dimension: v.literal('householdRole'), value: v.string() }),
				v.object({ dimension: v.literal('relationship'), value: v.string() }),
				v.object({
					dimension: v.literal('contactField'),
					fieldKey: v.string(),
					matchValue: v.optional(v.string())
				})
			)
		),
		count: v.union(v.literal('people'), v.literal('records'))
	})
);

/**
 * Replace a campaign's stat selection wholesale. One write for the whole list
 * because reordering is the common edit and a per-row mutation would make it a
 * sequence of writes that can half-apply.
 *
 * `statConfigsError` is the write-time gate — it is where a protected field key
 * is REFUSED rather than merely dropped later. It is not the only gate: the
 * engine re-derives every exposure decision at read time, because a config row
 * outlives the state it was saved under (a field can be un-published, a
 * checklist item made private, a key added to the denylist afterwards).
 */
export const setPublicStats = mutation({
	args: {
		campaignId: v.id('campaigns'),
		stats: v.array(
			v.object({
				id: v.string(),
				label: v.optional(v.string()),
				order: v.number(),
				showOnPublic: v.boolean(),
				showOnDashboard: v.boolean(),
				source: statSourceValidator
			})
		)
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'campaign:edit');

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			throw new ConvexError('Campaign not found');
		}
		await requireCapability(ctx, 'campaign:edit', campaign._id);

		const policy = await loadPublicPolicy(ctx, orgId);
		const error = statConfigsError(args.stats as StatConfig[], policy);
		if (error) {
			throw new ConvexError(error);
		}

		// Re-numbered from the submitted order so the stored `order` is always
		// dense: the UI reorders by moving rows, and a gap or a tie there would
		// leave the render order decided by the id tiebreak instead.
		const ordered = [...args.stats].sort((a, b) => a.order - b.order);

		await ctx.db.patch('campaigns', args.campaignId, {
			publicStats: ordered.map((stat, index) => ({
				...stat,
				label: stat.label?.trim() || undefined,
				order: index
			}))
		});
		return args.campaignId;
	}
});

export const deleteCampaign = mutation({
	args: {
		campaignId: v.id('campaigns')
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'campaign:delete');

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			throw new ConvexError('Campaign not found');
		}

		await deleteCampaignCascade(ctx, args.campaignId);
		return null;
	}
});
