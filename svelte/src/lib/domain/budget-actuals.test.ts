import { describe, expect, it } from 'vitest';
import {
	actualForItem,
	buildBudgetLedger,
	humanizeBudgetKey,
	normalizeBudgetItem,
	proofCountForItem,
	UNASSIGNED_BUDGET_ITEM,
	type ActualAllocation,
	type FixedItem
} from './budget-actuals';

// Stand-in for the nine template snapshot line items (only their keys and
// labels matter to the pure helper).
const fixedItems: FixedItem[] = [
	{ key: 'rent_cents', label: 'Rent' },
	{ key: 'food_cents', label: 'Food' },
	{ key: 'school_cents', label: 'School' },
	{ key: 'medical_cents', label: 'Medical care' },
	{ key: 'utilities_cents', label: 'Utilities' },
	{ key: 'clothing_cents', label: 'Clothing' },
	{ key: 'transport_cents', label: 'Transport' },
	{ key: 'household_cents', label: 'Household' },
	{ key: 'contingency_cents', label: 'Contingency' }
];

const budget = {
	templateSnapshot: { rent_cents: 100000, food_cents: 50000 },
	debtCents: 200000,
	extras: [{ label: 'Medical', amount_cents: 30000 }]
};

// Expenditure allocations into the project's fund, each already tagged (or
// left untagged) with a budget line.
const allocationRows: ActualAllocation[] = [
	{ budgetItem: 'rent_cents', amountCents: 40000 },
	{ budgetItem: 'rent_cents', amountCents: 60000 },
	{ budgetItem: 'debt', amountCents: 250000 }, // overspent vs 200000
	{ budgetItem: 'Medical', amountCents: 15000 },
	{ budgetItem: null, amountCents: 9999 }, // untagged — Unassigned bucket
	{ budgetItem: null, amountCents: 1 } // untagged
];

describe('normalizeBudgetItem', () => {
	it('keeps a real tag', () => {
		expect(normalizeBudgetItem('rent_cents')).toBe('rent_cents');
	});

	it('treats undefined, empty and whitespace-only as untagged', () => {
		expect(normalizeBudgetItem(undefined)).toBeNull();
		expect(normalizeBudgetItem(null)).toBeNull();
		expect(normalizeBudgetItem('')).toBeNull();
		expect(normalizeBudgetItem('   ')).toBeNull();
	});

	it('trims surrounding whitespace so a tag still matches its line', () => {
		expect(normalizeBudgetItem('  debt  ')).toBe('debt');
	});
});

describe('humanizeBudgetKey', () => {
	it('drops the _cents suffix and unpacks separators', () => {
		expect(humanizeBudgetKey('rent_cents')).toBe('rent');
		expect(humanizeBudgetKey('medical_care_cents')).toBe('medical care');
		expect(humanizeBudgetKey('school-fees')).toBe('school fees');
	});

	it('leaves a plain key alone', () => {
		expect(humanizeBudgetKey('debt')).toBe('debt');
	});
});

describe('actualForItem', () => {
	it('sums matching allocation rows', () => {
		expect(actualForItem('rent_cents', allocationRows)).toBe(100000);
	});

	it('returns 0 when nothing matches', () => {
		expect(actualForItem('school_cents', allocationRows)).toBe(0);
	});

	it('sums untagged rows under the null key', () => {
		expect(actualForItem(null, allocationRows)).toBe(10000);
	});

	it('returns 0 for an empty ledger', () => {
		expect(actualForItem('rent_cents', [])).toBe(0);
		expect(actualForItem(null, [])).toBe(0);
	});
});

describe('proofCountForItem', () => {
	it('counts every matching allocation', () => {
		expect(proofCountForItem('rent_cents', allocationRows)).toBe(2);
		expect(proofCountForItem('debt', allocationRows)).toBe(1);
		expect(proofCountForItem('school_cents', allocationRows)).toBe(0);
		expect(proofCountForItem(null, allocationRows)).toBe(2);
	});
});

describe('buildBudgetLedger', () => {
	const ledger = buildBudgetLedger(budget, allocationRows, fixedItems);

	it('emits a row per fixed item, debt, each extra, and an Unassigned bucket', () => {
		// 9 fixed items + debt + 1 extra + 1 unassigned.
		expect(ledger.rows).toHaveLength(12);
		expect(ledger.rows.filter((row) => row.group === 'fixed')).toHaveLength(9);
		expect(ledger.rows.filter((row) => row.group === 'debt')).toHaveLength(1);
		expect(ledger.rows.filter((row) => row.group === 'extra')).toHaveLength(1);
		expect(ledger.rows.filter((row) => row.group === 'unassigned')).toHaveLength(1);
	});

	it('computes budgeted, actual, delta, ratio and proof per row', () => {
		const rent = ledger.rows.find((row) => row.key === 'rent_cents')!;
		expect(rent.budgetedCents).toBe(100000);
		expect(rent.actualCents).toBe(100000);
		expect(rent.deltaCents).toBe(0);
		expect(rent.ratio).toBe(1);
		expect(rent.proofCount).toBe(2);

		const debt = ledger.rows.find((row) => row.key === 'debt')!;
		expect(debt.actualCents).toBe(250000);
		expect(debt.deltaCents).toBe(50000); // overspent
		expect(debt.ratio).toBeCloseTo(1.25);
	});

	it('reports an under-spent line as a negative delta', () => {
		const food = ledger.rows.find((row) => row.key === 'food_cents')!;
		expect(food.budgetedCents).toBe(50000);
		expect(food.actualCents).toBe(0);
		expect(food.deltaCents).toBe(-50000);
		expect(food.ratio).toBe(0);
	});

	it('matches an extra by its literal label', () => {
		const extra = ledger.rows.find((row) => row.group === 'extra')!;
		expect(extra.key).toBe('Medical');
		expect(extra.budgetedCents).toBe(30000);
		expect(extra.actualCents).toBe(15000);
	});

	it('rolls untagged fund expenditures into the Unassigned row (budget 0)', () => {
		const unassigned = ledger.rows.find((row) => row.key === UNASSIGNED_BUDGET_ITEM)!;
		expect(unassigned.group).toBe('unassigned');
		expect(unassigned.budgetedCents).toBe(0);
		expect(unassigned.actualCents).toBe(10000);
		expect(unassigned.ratio).toBeNull();
		expect(unassigned.proofCount).toBe(2);
	});

	it('yields a null ratio for zero-budgeted lines', () => {
		const school = ledger.rows.find((row) => row.key === 'school_cents')!;
		expect(school.budgetedCents).toBe(0);
		expect(school.ratio).toBeNull();
	});

	it('omits the Unassigned row when every expenditure is tagged', () => {
		const tagged = allocationRows.filter((row) => row.budgetItem !== null);
		const clean = buildBudgetLedger(budget, tagged, fixedItems);
		expect(clean.rows.filter((row) => row.group === 'unassigned')).toHaveLength(0);
		expect(clean.rows).toHaveLength(11);
	});

	it('totals budgeted against actual and reconciles remaining', () => {
		// 100000 + 50000 (fixed) + 200000 (debt) + 30000 (extra)
		expect(ledger.totalBudgetedCents).toBe(380000);
		// rent 100000 + debt 250000 + medical 15000 + unassigned 10000
		expect(ledger.totalActualCents).toBe(375000);
		expect(ledger.remainingCents).toBe(5000);
	});

	it('derives one fixed row per templateSnapshot key when none are supplied', () => {
		const derived = buildBudgetLedger(budget, allocationRows);
		expect(derived.rows.filter((row) => row.group === 'fixed').map((row) => row.key)).toEqual([
			'rent_cents',
			'food_cents'
		]);
		// Same money either way — extra zero-budget rows change no total.
		expect(derived.totalBudgetedCents).toBe(ledger.totalBudgetedCents);
		expect(derived.totalActualCents).toBe(ledger.totalActualCents);
	});

	it('keeps the ledger sane with no allocations at all', () => {
		const empty = buildBudgetLedger(budget, [], fixedItems);
		expect(empty.rows.every((row) => row.actualCents === 0)).toBe(true);
		expect(empty.rows.filter((row) => row.group === 'unassigned')).toHaveLength(0);
		expect(empty.totalActualCents).toBe(0);
		expect(empty.remainingCents).toBe(380000);
	});

	it('reports every cent as untagged when nothing carries a budgetItem', () => {
		// The shape of our seeded data: real spend, no budgetItem anywhere.
		const untagged: ActualAllocation[] = [
			{ budgetItem: null, amountCents: 125000 },
			{ budgetItem: null, amountCents: 75000 }
		];
		const seeded = buildBudgetLedger(budget, untagged, fixedItems);
		expect(
			seeded.rows.filter((row) => row.group !== 'unassigned').every((r) => r.actualCents === 0)
		).toBe(true);
		const unassigned = seeded.rows.find((row) => row.group === 'unassigned')!;
		expect(unassigned.actualCents).toBe(200000);
		expect(seeded.totalActualCents).toBe(200000);
		expect(seeded.remainingCents).toBe(180000);
	});
});
