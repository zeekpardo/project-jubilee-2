import { v } from 'convex/values';
import { query } from '../_generated/server';
import { activeOrgId } from '../model/auth';

export const getBudgetForProject = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return null;
		}

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
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return null;
		}

		const budget = await ctx.db.get('budgets', args.budgetId);
		if (!budget || budget.orgId !== orgId) {
			return null;
		}

		return budget;
	}
});
