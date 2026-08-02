import { v } from 'convex/values';
import { query } from '../_generated/server';
import { activeOrgId } from '../model/auth';
import { activeTaskTemplate, listProjectTasks } from '../model/tasks';

/**
 * A project's checklist. Returns the task rows plus how many items the
 * campaign's active template holds that this project has not been given yet,
 * so the UI can offer to fill them in without a second query.
 */
export const listTasks = query({
	args: { projectId: v.id('projects') },
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) return { tasks: [], pendingTemplateItems: 0, hasActiveTemplate: false };

		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== orgId) {
			return { tasks: [], pendingTemplateItems: 0, hasActiveTemplate: false };
		}

		const tasks = await listProjectTasks(ctx, args.projectId);
		const template = await activeTaskTemplate(ctx, project.campaignId);
		const have = new Set(tasks.map((task) => task.key));

		return {
			tasks,
			pendingTemplateItems: (template?.items ?? []).filter((item) => !have.has(item.key)).length,
			hasActiveTemplate: template !== null
		};
	}
});
