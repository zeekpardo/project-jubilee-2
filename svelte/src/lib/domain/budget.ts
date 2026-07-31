// Pure budget math — no db imports. See PLAN.md Phase 2.

export interface BudgetExtra {
	label: string;
	amount_cents: number;
}

/**
 * Computed budget target in integer cents:
 * sum of template snapshot line items + debt + extras.
 */
export function budgetTarget(
	snapshot: Record<string, number>,
	debtCents: number,
	extras: BudgetExtra[] = []
): number {
	const snapshotTotal = Object.values(snapshot).reduce((sum, cents) => sum + cents, 0);
	const extrasTotal = extras.reduce((sum, extra) => sum + extra.amount_cents, 0);
	return snapshotTotal + debtCents + extrasTotal;
}
