import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { createBudgetModel, recomputeTarget, resolveCostTemplate } from '../model/budgets';
import { requireOrgId } from '../model/auth';

async function requireBudget(
	ctx: MutationCtx,
	orgId: string,
	budgetId: Id<'budgets'>
): Promise<Doc<'budgets'>> {
	const budget = await ctx.db.get('budgets', budgetId);
	if (!budget || budget.orgId !== orgId) {
		throw new ConvexError('Budget not found');
	}
	return budget;
}

const extrasValidator = v.array(v.object({ label: v.string(), amount_cents: v.number() }));

export const createBudget = mutation({
	args: {
		projectId: v.id('projects'),
		costTemplateId: v.optional(v.id('costTemplates')),
		debtCents: v.optional(v.number()),
		extras: v.optional(extrasValidator)
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		return await createBudgetModel(ctx, { ...args, orgId });
	}
});

// targetCents is deliberately absent — it is always derived, never supplied.
export const updateBudget = mutation({
	args: {
		budgetId: v.id('budgets'),
		debtCents: v.optional(v.number()),
		extras: v.optional(extrasValidator)
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const budget = await requireBudget(ctx, orgId, args.budgetId);

		return await recomputeTarget(ctx, budget, {
			debtCents: args.debtCents,
			extras: args.extras
		});
	}
});

// Import semantics: an admin deliberately pulls a newer rate card into an
// existing budget. Debt and extras are preserved.
export const reapplyTemplate = mutation({
	args: {
		budgetId: v.id('budgets'),
		costTemplateId: v.id('costTemplates')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const budget = await requireBudget(ctx, orgId, args.budgetId);

		const project = await ctx.db.get('projects', budget.projectId);
		if (!project || project.orgId !== orgId) {
			throw new ConvexError('Project not found');
		}

		const costTemplate = await resolveCostTemplate(
			ctx,
			orgId,
			project.campaignId,
			args.costTemplateId
		);

		return await recomputeTarget(ctx, budget, {
			templateVersion: costTemplate.version,
			templateSnapshot: { ...costTemplate.lineItems }
		});
	}
});

export const deleteBudget = mutation({
	args: {
		budgetId: v.id('budgets')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireBudget(ctx, orgId, args.budgetId);

		await ctx.db.delete('budgets', args.budgetId);
		return null;
	}
});
