import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

/**
 * Convex has no foreign keys or ON DELETE CASCADE, so every dependent row must
 * be removed explicitly. These helpers are the single place that knows the
 * delete order, so a new child table only has to be handled once.
 */

export async function deleteProjectCascade(
	ctx: MutationCtx,
	projectId: Id<'projects'>
): Promise<void> {
	const budgets = await ctx.db
		.query('budgets')
		.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
		.collect();
	for (const budget of budgets) {
		await ctx.db.delete('budgets', budget._id);
	}

	const documents = await ctx.db
		.query('documents')
		.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
		.collect();
	for (const document of documents) {
		await ctx.db.delete('documents', document._id);
	}

	// Allocations are CLEARED, never deleted: the money still moved, so the
	// ledger total must survive. The allocation just becomes campaign-level.
	const allocations = await ctx.db
		.query('allocations')
		.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
		.collect();
	for (const allocation of allocations) {
		await ctx.db.patch('allocations', allocation._id, { projectId: undefined });
	}

	await ctx.db.delete('projects', projectId);
}

export async function deleteCampaignCascade(
	ctx: MutationCtx,
	campaignId: Id<'campaigns'>
): Promise<void> {
	// Allocations go first so the per-project clearing below finds nothing left
	// to do. Transactions themselves are org-level and survive: the money still
	// moved, it simply becomes unallocated.
	const allocations = await ctx.db
		.query('allocations')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const allocation of allocations) {
		await ctx.db.delete('allocations', allocation._id);
	}

	const projects = await ctx.db
		.query('projects')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const project of projects) {
		await deleteProjectCascade(ctx, project._id);
	}

	const stages = await ctx.db
		.query('pipelineStages')
		.withIndex('by_campaignId_and_order', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const stage of stages) {
		await ctx.db.delete('pipelineStages', stage._id);
	}

	const costs = await ctx.db
		.query('costTemplates')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const cost of costs) {
		await ctx.db.delete('costTemplates', cost._id);
	}

	const tasks = await ctx.db
		.query('taskTemplates')
		.withIndex('by_campaignId_and_version', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const task of tasks) {
		await ctx.db.delete('taskTemplates', task._id);
	}

	await ctx.db.delete('campaigns', campaignId);
}
