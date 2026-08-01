// Proof — mapping a budget ledger row back to the expenditures behind it.
//
// `buildBudgetLedger` gives each row a `proofCount`: how many EXPENDITURE
// ALLOCATIONS are tagged to that line. It counts allocations, not receipts — an
// expenditure recorded without a receipt still contributes to the count and
// still belongs in the proof list, it just has nothing to link to. These
// helpers reproduce exactly the match `buildBudgetLedger` counted with, so the
// number on the trigger and the number of cards behind it can never disagree.

import type { LedgerRow } from '$lib/domain/budget-actuals';

/** The parts of a ledger row that decide which allocations it owns. */
export type ProofRow = Pick<LedgerRow, 'key' | 'group'>;

/**
 * The `budgetItem` tag a row matches on. The synthetic "Unassigned" row is not
 * a budget line — it collects the allocations with no tag at all, the domain's
 * `null` — so its own key is never a tag anything carries.
 */
export function proofMatchKey(row: ProofRow): string | null {
	return row.group === 'unassigned' ? null : row.key;
}

/** The expenditure allocations contributing to one ledger row, in query order. */
export function expendituresForRow<T extends { budgetItem: string | null }>(
	row: ProofRow,
	expenditures: readonly T[]
): T[] {
	const match = proofMatchKey(row);
	return expenditures.filter((expenditure) => expenditure.budgetItem === match);
}

/**
 * The 'method · reference' line of a proof card: whichever of the two is
 * present, or null when neither is — the caller shows a placeholder then.
 */
export function proofSource(
	method: string | null | undefined,
	reference: string | null | undefined
): string | null {
	const parts = [method, reference].map((part) => part?.trim() ?? '').filter((part) => part !== '');
	return parts.length === 0 ? null : parts.join(' · ');
}
