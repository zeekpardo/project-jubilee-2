import { describe, expect, it } from 'vitest';
import { budgetTarget } from './budget';

const snapshot = {
	rent_cents: 10000,
	food_cents: 20000,
	school_cents: 70500
};

describe('budgetTarget', () => {
	it('sums snapshot line items, debt, and extras', () => {
		expect(
			budgetTarget(snapshot, 150000, [
				{ label: 'Medical', amount_cents: 5000 },
				{ label: 'Travel', amount_cents: 2500 }
			])
		).toBe(10000 + 20000 + 70500 + 150000 + 5000 + 2500);
	});

	it('handles empty extras (default)', () => {
		expect(budgetTarget(snapshot, 0)).toBe(100500);
		expect(budgetTarget(snapshot, 0, [])).toBe(100500);
	});

	it('handles an empty snapshot', () => {
		expect(budgetTarget({}, 12300, [])).toBe(12300);
	});

	it('returns zero when everything is empty', () => {
		expect(budgetTarget({}, 0, [])).toBe(0);
	});

	it('includes zero-valued line items without effect', () => {
		expect(budgetTarget({ admin_cents: 0, school_cents: 132300 }, 0)).toBe(132300);
	});
});
