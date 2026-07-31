import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { authComponent, createAuth } from '../auth';

async function requireOrgId(ctx: MutationCtx): Promise<string> {
	const user = await authComponent.safeGetAuthUser(ctx);
	if (!user) {
		throw new ConvexError('Not authenticated');
	}

	const auth = createAuth(ctx);
	const organization = await auth.api.getFullOrganization({
		headers: await authComponent.getHeaders(ctx)
	});
	if (!organization) {
		throw new ConvexError('No active organization');
	}

	return organization.id;
}

async function requireCampaign(
	ctx: MutationCtx,
	orgId: string,
	campaignId: Id<'campaigns'>
): Promise<Doc<'campaigns'>> {
	const campaign = await ctx.db.get('campaigns', campaignId);
	if (!campaign || campaign.orgId !== orgId) {
		throw new ConvexError('Campaign not found');
	}
	return campaign;
}

async function campaignStages(
	ctx: MutationCtx,
	campaignId: Id<'campaigns'>
): Promise<Doc<'pipelineStages'>[]> {
	return await ctx.db
		.query('pipelineStages')
		.withIndex('by_campaignId_and_order', (q) => q.eq('campaignId', campaignId))
		.collect();
}

async function clearFlagOnOthers(
	ctx: MutationCtx,
	campaignId: Id<'campaigns'>,
	field: 'isDefault' | 'isFundedGate',
	keepId: Id<'pipelineStages'> | null
): Promise<void> {
	const stages = await campaignStages(ctx, campaignId);
	for (const stage of stages) {
		if (stage._id !== keepId && stage[field]) {
			await ctx.db.patch('pipelineStages', stage._id, { [field]: false });
		}
	}
}

const kindValidator = v.union(v.literal('funnel'), v.literal('terminal'));

export const createStage = mutation({
	args: {
		campaignId: v.id('campaigns'),
		key: v.string(),
		label: v.string(),
		order: v.number(),
		kind: kindValidator,
		accent: v.optional(v.string()),
		isDefault: v.optional(v.boolean()),
		isFundedGate: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireCampaign(ctx, orgId, args.campaignId);

		const conflict = await ctx.db
			.query('pipelineStages')
			.withIndex('by_campaignId_and_key', (q) =>
				q.eq('campaignId', args.campaignId).eq('key', args.key)
			)
			.first();
		if (conflict) {
			throw new ConvexError('Stage key already in use for this campaign');
		}

		const isDefault = args.isDefault ?? false;
		const isFundedGate = args.isFundedGate ?? false;

		const stageId = await ctx.db.insert('pipelineStages', {
			orgId,
			campaignId: args.campaignId,
			key: args.key,
			label: args.label,
			order: args.order,
			kind: args.kind,
			accent: args.accent,
			isDefault,
			isFundedGate,
			// Only campaign seeding creates protected stages.
			isSystem: false
		});

		if (isDefault) {
			await clearFlagOnOthers(ctx, args.campaignId, 'isDefault', stageId);
		}
		if (isFundedGate) {
			await clearFlagOnOthers(ctx, args.campaignId, 'isFundedGate', stageId);
		}

		return stageId;
	}
});

// `key` is deliberately absent from these args — a system stage's key is immutable.
export const updateStage = mutation({
	args: {
		stageId: v.id('pipelineStages'),
		label: v.optional(v.string()),
		order: v.optional(v.number()),
		kind: v.optional(kindValidator),
		accent: v.optional(v.string()),
		isDefault: v.optional(v.boolean()),
		isFundedGate: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);

		const stage = await ctx.db.get('pipelineStages', args.stageId);
		if (!stage || stage.orgId !== orgId) {
			throw new ConvexError('Stage not found');
		}

		const { stageId, ...updates } = args;

		if (updates.isDefault === false && stage.isDefault) {
			throw new ConvexError(
				'A campaign must have a default stage — mark another stage as default instead'
			);
		}

		const patch: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(updates)) {
			if (value !== undefined) {
				patch[key] = value;
			}
		}

		await ctx.db.patch('pipelineStages', stageId, patch as Partial<Doc<'pipelineStages'>>);

		if (updates.isDefault === true) {
			await clearFlagOnOthers(ctx, stage.campaignId, 'isDefault', stageId);
		}
		if (updates.isFundedGate === true) {
			await clearFlagOnOthers(ctx, stage.campaignId, 'isFundedGate', stageId);
		}

		return stageId;
	}
});

export const deleteStage = mutation({
	args: {
		stageId: v.id('pipelineStages')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);

		const stage = await ctx.db.get('pipelineStages', args.stageId);
		if (!stage || stage.orgId !== orgId) {
			throw new ConvexError('Stage not found');
		}

		if (stage.isSystem) {
			throw new ConvexError('System stages cannot be deleted');
		}
		if (stage.isDefault) {
			throw new ConvexError(
				'The default stage cannot be deleted — mark another stage as default first'
			);
		}

		const occupant = await ctx.db
			.query('projects')
			.withIndex('by_campaignId_and_stage', (q) =>
				q.eq('campaignId', stage.campaignId).eq('stage', stage.key)
			)
			.first();
		if (occupant) {
			throw new ConvexError('Stage still has projects in it — move them to another stage first');
		}

		await ctx.db.delete('pipelineStages', args.stageId);
		return null;
	}
});

export const reorderStages = mutation({
	args: {
		campaignId: v.id('campaigns'),
		orderedStageIds: v.array(v.id('pipelineStages'))
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireCampaign(ctx, orgId, args.campaignId);

		const stages = await campaignStages(ctx, args.campaignId);
		const known = new Set(stages.map((stage) => stage._id as string));
		const seen = new Set<string>();

		for (const stageId of args.orderedStageIds) {
			if (!known.has(stageId)) {
				throw new ConvexError('Stage does not belong to this campaign');
			}
			if (seen.has(stageId)) {
				throw new ConvexError('Duplicate stage in ordering');
			}
			seen.add(stageId);
		}
		if (seen.size !== stages.length) {
			throw new ConvexError('Ordering must include every stage in the campaign');
		}

		for (let index = 0; index < args.orderedStageIds.length; index++) {
			await ctx.db.patch('pipelineStages', args.orderedStageIds[index], { order: index });
		}

		return null;
	}
});
