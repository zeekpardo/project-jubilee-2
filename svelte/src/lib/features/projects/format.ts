import { budgetTarget, type BudgetExtra } from '$lib/domain/budget';

export type BudgetLike = {
	templateSnapshot: Record<string, number>;
	debtCents: number;
	extras: BudgetExtra[];
};

const MONEY = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});

/** The one place integer cents become a display string. */
export function formatCents(cents: number | null | undefined): string {
	return MONEY.format((cents ?? 0) / 100);
}

/** Budget target in cents, always through the domain helper. */
export function targetCentsFor(budget: BudgetLike | null | undefined): number {
	if (!budget) return 0;
	return budgetTarget(budget.templateSnapshot, budget.debtCents, budget.extras);
}

/** Raised against target as a 0–100 whole number. */
export function progressPercent(raisedCents: number, targetCentsValue: number): number {
	if (targetCentsValue <= 0) return raisedCents > 0 ? 100 : 0;
	return Math.max(0, Math.min(100, Math.round((raisedCents / targetCentsValue) * 100)));
}
