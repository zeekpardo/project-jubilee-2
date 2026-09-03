// The read side. Both gates are `readableOrgId` rather than `requireCapability`
// for the reason the whole app uses it in queries: a query re-runs on every
// subscription tick, and an admin who loses the capability should watch the
// screen empty rather than watch it fill with errors.
import { v } from 'convex/values';
import { query } from '../_generated/server';
import { readableOrgId } from '../model/access';

const LIST_MAX = 100;

export const listWorkflows = query({
	args: {},
	handler: async (ctx) => {
		const orgId = await readableOrgId(ctx, 'settings:manage');
		if (!orgId) return [];
		return await ctx.db
			.query('workflows')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.take(LIST_MAX);
	}
});

export const getWorkflow = query({
	args: { workflowId: v.id('workflows') },
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'settings:manage');
		if (!orgId) return null;

		const workflow = await ctx.db.get('workflows', args.workflowId);
		if (!workflow || workflow.orgId !== orgId) return null;

		// Newest first: the editor shows history, and the thing anyone wants to
		// see is what is running now.
		const versions = await ctx.db
			.query('workflowVersions')
			.withIndex('by_workflowId_and_version', (q) => q.eq('workflowId', workflow._id))
			.order('desc')
			.take(LIST_MAX);

		return { workflow, versions };
	}
});
