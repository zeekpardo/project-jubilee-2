import { describe, expect, it } from 'vitest';
import { centsToDollarInput, dollarsToCents, positiveDollarsToCents, sumCents } from './amount';

describe('dollarsToCents', () => {
	it('parses whole dollars', () => {
		expect(dollarsToCents('150')).toBe(15000);
		expect(dollarsToCents('0')).toBe(0);
	});

	it('parses one and two decimal places', () => {
		expect(dollarsToCents('150.2')).toBe(15020);
		expect(dollarsToCents('150.25')).toBe(15025);
		expect(dollarsToCents('.5')).toBe(50);
	});

	it('strips currency symbols, separators and surrounding space', () => {
		expect(dollarsToCents(' $1,234.50 ')).toBe(123450);
	});

	it('rejects a third decimal place rather than rounding it away', () => {
		expect(dollarsToCents('12.345')).toBeNull();
	});

	it('rejects empty and non-numeric input', () => {
		expect(dollarsToCents('')).toBeNull();
		expect(dollarsToCents('   ')).toBeNull();
		expect(dollarsToCents('abc')).toBeNull();
		expect(dollarsToCents('.')).toBeNull();
		expect(dollarsToCents('1.2.3')).toBeNull();
	});

	it('keeps negatives, which the ledger boundary is free to reject', () => {
		expect(dollarsToCents('-12.34')).toBe(-1234);
	});

	// The whole point of parsing the string rather than multiplying a float:
	// 0.1 * 100 is 10.000000000000002 in IEEE-754.
	it('never drifts off an integer', () => {
		expect(dollarsToCents('0.1')).toBe(10);
		expect(dollarsToCents('1.15')).toBe(115);
		expect(dollarsToCents('8.29')).toBe(829);
		expect(Number.isSafeInteger(dollarsToCents('99999999.99') as number)).toBe(true);
	});

	it('rejects an amount too large to hold exactly in cents', () => {
		expect(dollarsToCents('99999999999999999')).toBeNull();
	});
});

describe('positiveDollarsToCents', () => {
	it('accepts a real charge', () => {
		expect(positiveDollarsToCents('150.00')).toBe(15000);
		expect(positiveDollarsToCents('0.01')).toBe(1);
	});

	it('rejects zero, negatives and unparseable input', () => {
		expect(positiveDollarsToCents('0')).toBeNull();
		expect(positiveDollarsToCents('0.00')).toBeNull();
		expect(positiveDollarsToCents('-5')).toBeNull();
		expect(positiveDollarsToCents('')).toBeNull();
		expect(positiveDollarsToCents('12.345')).toBeNull();
	});
});

describe('centsToDollarInput', () => {
	it('round-trips through dollarsToCents', () => {
		expect(centsToDollarInput(15025)).toBe('150.25');
		expect(dollarsToCents(centsToDollarInput(15025))).toBe(15025);
		expect(centsToDollarInput(0)).toBe('0.00');
	});
});

describe('sumCents', () => {
	it('totals a line-item record', () => {
		expect(sumCents({ rent_cents: 100000, food_cents: 50000 })).toBe(150000);
		expect(sumCents({})).toBe(0);
	});
});
