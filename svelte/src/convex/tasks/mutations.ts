import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import { requireCapability } from '../model/access';
import { instantiateTasks, requireTaskProject } from '../model/tasks';

/**
 * Give a project the checklist items its campaign's active template defines
 * and it does not have yet. Idempotent, and safe to call again after a new
 * template version is activated — see instantiateTasks for why it only ever
 * adds.
 */
export const syncProjectTasks = mutation({
	args: { projectId: v.id('projects') },
	handler: async (ctx, args) => {
		// The campaign is only known after the project is read, so the org gate
		// comes first and the campaign-scoped one straight after.
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const project = await requireTaskProject(ctx, orgId, args.projectId);
		await requireCapability(ctx, 'projects:write', project.campaignId);

		return await instantiateTasks(ctx, project);
	}
});

/**
 * Tick or un-tick one checklist item. `completedAt` is what every task-sourced
 * stat filters on, so it is cleared as well as set — an item un-ticked by
 * mistake must not keep counting toward a date-filtered figure.
 */
export const setTaskStatus = mutation({
	args: {
		taskId: v.id('tasks'),
		status: v.union(v.literal('todo'), v.literal('done'))
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');

		const task = await ctx.db.get('tasks', args.taskId);
		if (!task || task.orgId !== orgId) {
			throw new ConvexError('Task not found');
		}
		const { userId } = await requireCapability(ctx, 'projects:write', task.campaignId);

		await ctx.db.patch('tasks', task._id, {
			status: args.status,
			completedAt: args.status === 'done' ? Date.now() : undefined,
			completedBy: args.status === 'done' ? userId : undefined
		});

		return task._id;
	}
});

/** A free-text note against one checklist item. */
export const setTaskNote = mutation({
	args: { taskId: v.id('tasks'), note: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');

		const task = await ctx.db.get('tasks', args.taskId);
		if (!task || task.orgId !== orgId) {
			throw new ConvexError('Task not found');
		}
		await requireCapability(ctx, 'projects:write', task.campaignId);

		await ctx.db.patch('tasks', task._id, { note: args.note?.trim() || undefined });
		return task._id;
	}
});
