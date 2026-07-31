import { ConvexError } from 'convex/values';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { BudgetExtra } from '../../lib/domain/budget';
import { budgetTarget } from '../../lib/domain/budget';

export type CreateBudgetInput = {
	orgId: string;
	projectId: Id<'projects'>;
	costTemplateId?: Id<'costTemplates'>;
	debtCents?: number;
	extras?: BudgetExtra[];
};

/** Every money field a budget's target is derived from. */
export type BudgetInputs = {
	templateVersion: string;
	templateSnapshot: Record<string, number>;
	debtCents: number;
	extras: BudgetExtra[];
};

function assertCents(label: string, cents: number): void {
	if (!Number.isInteger(cents)) {
		throw new ConvexError(`${label} must be an integer number of cents`);
	}
}

function assertMoney(inputs: BudgetInputs): void {
	for (const [key, cents] of Object.entries(inputs.templateSnapshot)) {
		assertCents(`Template line item "${key}"`, cents);
	}
	assertCents('debtCents', inputs.debtCents);
	for (const extra of inputs.extras) {
		assertCents(`Extra "${extra.label}"`, extra.amount_cents);
	}
}

/**
 * The only place targetCents is produced. Callers never supply it, so the
 * stored value cannot drift from the budgetTarget domain function.
 */
function withComputedTarget(inputs: BudgetInputs): BudgetInputs & { targetCents: number } {
	assertMoney(inputs);
	return {
		...inputs,
		targetCents: budgetTarget(inputs.templateSnapshot, inputs.debtCents, inputs.extras)
	};
}

/**
 * The single write path for an existing budget: applies the given changes on
 * top of the stored row and recomputes targetCents from the merged result.
 */
export async function recomputeTarget(
	ctx: MutationCtx,
	budget: Doc<'budgets'>,
	changes: Partial<BudgetInputs>
): Promise<Id<'budgets'>> {
	const next = withComputedTarget({
		templateVersion: changes.templateVersion ?? budget.templateVersion,
		templateSnapshot: changes.templateSnapshot ?? budget.templateSnapshot,
		debtCents: changes.debtCents ?? budget.debtCents,
		extras: changes.extras ?? budget.extras
	});

	await ctx.db.patch('budgets', budget._id, next);
	return budget._id;
}

/** The explicitly chosen cost template, else the campaign's newest version. */
export async function resolveCostTemplate(
	ctx: MutationCtx,
	orgId: string,
	campaignId: Id<'campaigns'>,
	costTemplateId?: Id<'costTemplates'>
): Promise<Doc<'costTemplates'>> {
	if (costTemplateId !== undefined) {
		const costTemplate = await ctx.db.get('costTemplates', costTemplateId);
		if (!costTemplate || costTemplate.orgId !== orgId || costTemplate.campaignId !== campaignId) {
			throw new ConvexError('Cost template not found');
		}
		return costTemplate;
	}

	// Append-only table, so the newest row is the campaign's current rate card.
	const latest = await ctx.db
		.query('costTemplates')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
		.order('desc')
		.first();
	if (!latest) {
		throw new ConvexError('Campaign has no cost template');
	}
	return latest;
}

/**
 * Creates the one budget a project may have, copying the resolved cost
 * template's line items. The copy is a snapshot, not a reference: later edits
 * to that template version must never retroactively change this budget.
 */
export async function createBudgetModel(
	ctx: MutationCtx,
	input: CreateBudgetInput
): Promise<Id<'budgets'>> {
	const project = await ctx.db.get('projects', input.projectId);
	if (!project || project.orgId !== input.orgId) {
		throw new ConvexError('Project not found');
	}

	// unique(projectId) — Convex has no unique constraints.
	const existing = await ctx.db
		.query('budgets')
		.withIndex('by_projectId', (q) => q.eq('projectId', input.projectId))
		.first();
	if (existing) {
		throw new ConvexError('Project already has a budget');
	}

	const costTemplate = await resolveCostTemplate(
		ctx,
		input.orgId,
		project.campaignId,
		input.costTemplateId
	);

	const fields = withComputedTarget({
		templateVersion: costTemplate.version,
		templateSnapshot: { ...costTemplate.lineItems },
		debtCents: input.debtCents ?? 0,
		extras: input.extras ?? []
	});

	return await ctx.db.insert('budgets', {
		orgId: input.orgId,
		projectId: input.projectId,
		...fields
	});
}
