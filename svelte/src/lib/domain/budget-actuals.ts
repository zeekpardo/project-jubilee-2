// Pure budget-actuals math — no db imports. Ported from the reference app's
// `budget-actuals.ts`.
//
// Single source of truth: a budget line's ACTUAL spend is the sum of
// EXPENDITURE allocations into the project's fund whose `budgetItem` tag points
// at that line (a template snapshot key, 'debt', or an extra's label).
// Expenditure allocations with no tag roll up into a synthetic "Unassigned" row
// so the ledger total still reconciles with every cent spent from the fund.
//
// Donations are deliberately out of scope — that is "raised", the donor-side
// comparison in `reconciliation.ts`. Transfers are out of scope too: they move
// money to the field and only change the org-level cash position.

/** Synthetic ledger key for expenditure allocations with no budgetItem. */
export const UNASSIGNED_BUDGET_ITEM = 'unassigned';

/**
 * Minimal expenditure-allocation shape needed to total actual spend: one row
 * per allocation of an expenditure transaction into the project's fund, tagged
 * (or not) with a budget line.
 */
export interface ActualAllocation {
	budgetItem: string | null;
	amountCents: number;
}

/** Minimal budget shape needed to build the ledger. */
export interface ActualsBudget {
	templateSnapshot: Record<string, number>;
	debtCents: number;
	extras: { label: string; amount_cents: number }[];
}

/** A template snapshot line item (key + display label), in display order. */
export interface FixedItem {
	key: string;
	label: string;
}

/**
 * The stored tag as a ledger key. Our schema types `budgetItem` as
 * `v.optional(v.string())`, and the allocation form can persist an empty
 * string, so both `undefined` and `''` mean "untagged" — the domain's `null`.
 */
export function normalizeBudgetItem(budgetItem: string | null | undefined): string | null {
	const trimmed = budgetItem?.trim();
	return trimmed ? trimmed : null;
}

/**
 * A snapshot key as a human label: 'rent_cents' → 'rent'. Callers capitalize
 * it in CSS, so this stays a plain lowercased phrase.
 */
export function humanizeBudgetKey(key: string): string {
	return key.replace(/_cents$/, '').replace(/[_-]+/g, ' ');
}

/**
 * Sum the actual spend for a single budget line, keyed by its budgetItem
 * value. `null` matches the untagged (Unassigned) allocations.
 */
export function actualForItem(item: string | null, allocationRows: ActualAllocation[]): number {
	let total = 0;
	for (const row of allocationRows) {
		if (row.budgetItem === item) total += row.amountCents;
	}
	return total;
}

/** Number of contributing expenditure allocations tied to a budget line. */
export function proofCountForItem(item: string | null, allocationRows: ActualAllocation[]): number {
	let count = 0;
	for (const row of allocationRows) {
		if (row.budgetItem === item) count += 1;
	}
	return count;
}

export interface LedgerRow {
	/** budgetItem key used to match allocations: snapshot key | 'debt' | extra label | 'unassigned'. */
	key: string;
	label: string;
	group: 'fixed' | 'debt' | 'extra' | 'unassigned';
	budgetedCents: number;
	actualCents: number;
	/** actualCents - budgetedCents (positive = overspent). */
	deltaCents: number;
	/** actualCents / budgetedCents in [0, ∞), or null when budgeted is 0. */
	ratio: number | null;
	/** Count of contributing expenditure allocations. */
	proofCount: number;
}

export interface BudgetLedger {
	rows: LedgerRow[];
	totalBudgetedCents: number;
	totalActualCents: number;
	/** totalBudgeted - totalActual (positive = under budget / unspent). */
	remainingCents: number;
}

function toRow(
	key: string,
	label: string,
	group: LedgerRow['group'],
	budgetedCents: number,
	allocationRows: ActualAllocation[],
	matchKey: string | null = key
): LedgerRow {
	const actualCents = actualForItem(matchKey, allocationRows);
	return {
		key,
		label,
		group,
		budgetedCents,
		actualCents,
		deltaCents: actualCents - budgetedCents,
		ratio: budgetedCents === 0 ? null : actualCents / budgetedCents,
		proofCount: proofCountForItem(matchKey, allocationRows)
	};
}

/** Every templateSnapshot key as a display-ordered fixed item, key as label. */
function fixedItemsFromSnapshot(snapshot: Record<string, number>): FixedItem[] {
	return Object.keys(snapshot).map((key) => ({ key, label: key }));
}

/**
 * Build the budgeted-vs-actual ledger for a project: one row per template
 * snapshot line item (in the caller's display order), the debt line, each
 * extra, and — when the fund has untagged expenditures — a trailing
 * "Unassigned" row so the actual total reconciles with the full fund spend.
 *
 * `fixedItems` and the debt key/label are passed in so this helper never
 * depends on presentation constants, keeping it pure and test-isolated. Omit
 * `fixedItems` to derive one row per `templateSnapshot` key, key as label.
 */
export function buildBudgetLedger(
	budget: ActualsBudget,
	allocationRows: ActualAllocation[],
	fixedItems: FixedItem[] = fixedItemsFromSnapshot(budget.templateSnapshot),
	debtItem = 'debt',
	debtLabel = 'Debt',
	unassignedLabel = 'Unassigned'
): BudgetLedger {
	const rows: LedgerRow[] = [];

	for (const item of fixedItems) {
		rows.push(
			toRow(item.key, item.label, 'fixed', budget.templateSnapshot[item.key] ?? 0, allocationRows)
		);
	}

	rows.push(toRow(debtItem, debtLabel, 'debt', budget.debtCents, allocationRows));

	for (const extra of budget.extras) {
		rows.push(toRow(extra.label, extra.label, 'extra', extra.amount_cents, allocationRows));
	}

	// Untagged expenditures — never budgeted, but must show so the actual total
	// ties out to every cent spent from the fund.
	const unassignedActual = actualForItem(null, allocationRows);
	if (unassignedActual > 0 || proofCountForItem(null, allocationRows) > 0) {
		rows.push(
			toRow(UNASSIGNED_BUDGET_ITEM, unassignedLabel, 'unassigned', 0, allocationRows, null)
		);
	}

	const totalBudgetedCents = rows.reduce((sum, row) => sum + row.budgetedCents, 0);
	const totalActualCents = rows.reduce((sum, row) => sum + row.actualCents, 0);

	return {
		rows,
		totalBudgetedCents,
		totalActualCents,
		remainingCents: totalBudgetedCents - totalActualCents
	};
}
