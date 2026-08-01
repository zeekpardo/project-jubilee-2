import { describe, expect, it } from 'vitest';
import { buildBudgetLedger, type ActualAllocation } from '$lib/domain/budget-actuals';
import { expendituresForRow, proofMatchKey, proofSource, type ProofRow } from './proof';

type Expenditure = ActualAllocation & { id: string; receiptUrl: string | null };

// Two receipted expenditures on rent, one unreceipted, one untagged.
const expenditures: Expenditure[] = [
	{ id: 'a', budgetItem: 'rent_cents', amountCents: 40000, receiptUrl: 'https://blob/a' },
	{ id: 'b', budgetItem: 'rent_cents', amountCents: 60000, receiptUrl: null },
	{ id: 'c', budgetItem: 'debt', amountCents: 250000, receiptUrl: 'https://blob/c' },
	{ id: 'd', budgetItem: null, amountCents: 9999, receiptUrl: null }
];

describe('proofMatchKey', () => {
	it('uses the row key for real budget lines', () => {
		expect(proofMatchKey({ key: 'rent_cents', group: 'fixed' })).toBe('rent_cents');
		expect(proofMatchKey({ key: 'debt', group: 'debt' })).toBe('debt');
		expect(proofMatchKey({ key: 'Medical', group: 'extra' })).toBe('Medical');
	});

	it('maps the synthetic Unassigned row to the untagged bucket, not its own key', () => {
		expect(proofMatchKey({ key: 'unassigned', group: 'unassigned' })).toBeNull();
	});
});

describe('expendituresForRow', () => {
	it('returns every allocation tagged to the line', () => {
		const rows = expendituresForRow({ key: 'rent_cents', group: 'fixed' }, expenditures);
		expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
	});

	it('counts an expenditure with no receipt — proofCount is allocations, not receipts', () => {
		const rows = expendituresForRow({ key: 'rent_cents', group: 'fixed' }, expenditures);
		expect(rows.some((row) => row.receiptUrl === null)).toBe(true);
	});

	it('collects the untagged allocations under Unassigned', () => {
		const rows = expendituresForRow({ key: 'unassigned', group: 'unassigned' }, expenditures);
		expect(rows.map((row) => row.id)).toEqual(['d']);
	});

	it('returns nothing for a line with no spend', () => {
		expect(expendituresForRow({ key: 'food_cents', group: 'fixed' }, expenditures)).toEqual([]);
	});

	it('never disagrees with the proofCount the ledger computed', () => {
		const ledger = buildBudgetLedger(
			{
				templateSnapshot: { rent_cents: 100000, food_cents: 50000 },
				debtCents: 200000,
				extras: [{ label: 'Medical', amount_cents: 30000 }]
			},
			expenditures
		);
		for (const row of ledger.rows) {
			const proofRow: ProofRow = { key: row.key, group: row.group };
			expect(expendituresForRow(proofRow, expenditures)).toHaveLength(row.proofCount);
		}
	});
});

describe('proofSource', () => {
	it('joins method and reference', () => {
		expect(proofSource('bank transfer', 'INV-204')).toBe('bank transfer · INV-204');
	});

	it('keeps whichever half is present', () => {
		expect(proofSource('cash', null)).toBe('cash');
		expect(proofSource(null, 'INV-204')).toBe('INV-204');
	});

	it('is null when both are missing or blank, so the caller can say so', () => {
		expect(proofSource(null, null)).toBeNull();
		expect(proofSource(undefined, undefined)).toBeNull();
		expect(proofSource('  ', '')).toBeNull();
	});

	it('trims, so a stray space never becomes a lonely separator', () => {
		expect(proofSource('  cash  ', '   ')).toBe('cash');
	});
});
