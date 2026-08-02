import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAccess } from '../model/access';
import { can } from '../../lib/domain/permissions';

export const getBudgetForProject = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) {
			return null;
		}

		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== access.orgId) {
			return null;
		}
		if (!can(access, 'money:read', project.campaignId)) {
			return null;
		}
		const orgId = access.orgId;

		const budget = await ctx.db
			.query('budgets')
			.withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
			.unique();
		if (!budget || budget.orgId !== orgId) {
			return null;
		}

		return budget;
	}
});

export const getBudget = query({
	args: {
		budgetId: v.id('budgets')
	},
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) {
			return null;
		}

		const budget = await ctx.db.get('budgets', args.budgetId);
		if (!budget || budget.orgId !== access.orgId) {
			return null;
		}

		const project = await ctx.db.get('projects', budget.projectId);
		if (!project || project.orgId !== access.orgId) {
			return null;
		}
		if (!can(access, 'money:read', project.campaignId)) {
			return null;
		}

		return budget;
	}
});
