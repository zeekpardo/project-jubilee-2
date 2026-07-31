import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireOrgId } from '../model/auth';
import {
	assertAllocatable,
	assertNonNegativeCents,
	assertProjectNotAlreadyAllocated,
	requireAllocation
} from '../model/money';

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

async function requireProjectInCampaign(
	ctx: MutationCtx,
	orgId: string,
	projectId: Id<'projects'>,
	campaignId: Id<'campaigns'>
): Promise<Doc<'projects'>> {
	const project = await ctx.db.get('projects', projectId);
	if (!project || project.orgId !== orgId) {
		throw new ConvexError('Project not found');
	}
	if (project.campaignId !== campaignId) {
		throw new ConvexError("Project does not belong to the allocation's campaign");
	}
	return project;
}

export const createAllocation = mutation({
	args: {
		transactionId: v.id('transactions'),
		campaignId: v.id('campaigns'),
		projectId: v.optional(v.id('projects')),
		amountCents: v.number(),
		budgetItem: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		assertNonNegativeCents('amountCents', args.amountCents);

		await requireCampaign(ctx, orgId, args.campaignId);
		if (args.projectId !== undefined) {
			await requireProjectInCampaign(ctx, orgId, args.projectId, args.campaignId);
			await assertProjectNotAlreadyAllocated(ctx, args.transactionId, args.projectId);
		}

		await assertAllocatable(ctx, args.transactionId, args.amountCents, { orgId });

		return await ctx.db.insert('allocations', { ...args, orgId });
	}
});

export const updateAllocation = mutation({
	args: {
		allocationId: v.id('allocations'),
		amountCents: v.optional(v.number()),
		budgetItem: v.optional(v.string()),
		projectId: v.optional(v.id('projects'))
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const allocation = await requireAllocation(ctx, orgId, args.allocationId);

		const patch: Partial<Omit<Doc<'allocations'>, '_id' | '_creationTime' | 'orgId'>> = {};

		if (args.projectId !== undefined && args.projectId !== allocation.projectId) {
			await requireProjectInCampaign(ctx, orgId, args.projectId, allocation.campaignId);
			await assertProjectNotAlreadyAllocated(
				ctx,
				allocation.transactionId,
				args.projectId,
				allocation._id
			);
			patch.projectId = args.projectId;
		}

		if (args.amountCents !== undefined) {
			assertNonNegativeCents('amountCents', args.amountCents);
			// The row being edited is excluded from the existing set, or its old
			// amount would be counted alongside its new one.
			await assertAllocatable(ctx, allocation.transactionId, args.amountCents, {
				orgId,
				excludeAllocationId: allocation._id
			});
			patch.amountCents = args.amountCents;
		}

		if (args.budgetItem !== undefined) {
			patch.budgetItem = args.budgetItem;
		}

		await ctx.db.patch('allocations', allocation._id, patch);
		return allocation._id;
	}
});

// Deletes attribution only: the transaction and its amount are untouched.
export const deleteAllocation = mutation({
	args: {
		allocationId: v.id('allocations')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const allocation = await requireAllocation(ctx, orgId, args.allocationId);

		await ctx.db.delete('allocations', allocation._id);
		return null;
	}
});
