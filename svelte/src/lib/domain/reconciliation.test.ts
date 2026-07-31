import { describe, expect, it } from 'vitest';
import {
	allocationRemainder,
	raisedForProject,
	reconciliation,
	type AllocationLike,
	type TransactionLike
} from './reconciliation';

const tx = (id: string, type: TransactionLike['type'], amountCents: number): TransactionLike => ({
	id,
	type,
	amountCents
});

const alloc = (
	transactionId: string,
	projectId: string | null,
	amountCents: number
): AllocationLike => ({
	transactionId,
	projectId,
	amountCents
});

describe('reconciliation', () => {
	it('computes totals and balances matching the sheet header math', () => {
		const transactions = [
			tx('d1', 'donation', 100000),
			tx('d2', 'donation', 50000),
			tx('t1', 'transfer', 120000),
			tx('e1', 'expenditure', 90000)
		];
		const result = reconciliation(transactions, []);
		expect(result.receivedCents).toBe(150000);
		expect(result.sentCents).toBe(120000);
		expect(result.spentCents).toBe(90000);
		expect(result.usBalanceCents).toBe(30000); // received − sent
		expect(result.pkBalanceCents).toBe(30000); // sent − spent
	});

	it('returns all zeroes for empty input', () => {
		const result = reconciliation([], []);
		expect(result.receivedCents).toBe(0);
		expect(result.usBalanceCents).toBe(0);
		expect(result.pkBalanceCents).toBe(0);
		expect(result.unallocatedByType).toEqual({
			donation: 0,
			transfer: 0,
			expenditure: 0
		});
	});

	it('tracks unallocated remainders per type', () => {
		const transactions = [tx('d1', 'donation', 100000), tx('e1', 'expenditure', 40000)];
		const allocations = [alloc('d1', 'p-001', 60000), alloc('e1', 'p-001', 40000)];
		const result = reconciliation(transactions, allocations);
		expect(result.unallocatedByType.donation).toBe(40000);
		expect(result.unallocatedByType.expenditure).toBe(0);
		expect(result.unallocatedByType.transfer).toBe(0);
	});
});

describe('allocationRemainder', () => {
	it('returns the full amount with no allocations', () => {
		expect(allocationRemainder(tx('d1', 'donation', 5000), [])).toBe(5000);
	});

	it('returns zero when fully allocated across funds', () => {
		const allocations = [alloc('d1', 'a', 3000), alloc('d1', 'b', 2000)];
		expect(allocationRemainder(tx('d1', 'donation', 5000), allocations)).toBe(0);
	});

	it('ignores allocations of other transactions', () => {
		const allocations = [alloc('other', 'a', 99999)];
		expect(allocationRemainder(tx('d1', 'donation', 5000), allocations)).toBe(5000);
	});

	it('throws on over-allocation', () => {
		const allocations = [alloc('d1', 'a', 3000), alloc('d1', 'b', 2001)];
		expect(() => allocationRemainder(tx('d1', 'donation', 5000), allocations)).toThrow(
			/Over-allocated/
		);
	});
});

describe('raisedForProject', () => {
	const transactions = [
		tx('d1', 'donation', 100000),
		tx('d2', 'donation', 25000),
		tx('t1', 'transfer', 100000),
		tx('e1', 'expenditure', 50000)
	];

	it('sums donation allocations attributed to the project only', () => {
		const allocations = [
			alloc('d1', 'p001', 60000),
			alloc('d2', 'p001', 25000),
			alloc('d1', 'other', 40000),
			// campaign-level (project-less) donation must not count toward p001
			alloc('d1', null, 15000),
			// transfers/expenditures to the project must not count as raised
			alloc('t1', 'p001', 100000),
			alloc('e1', 'p001', 50000)
		];
		expect(raisedForProject('p001', transactions, allocations)).toBe(85000);
	});

	it('returns zero with empty allocations', () => {
		expect(raisedForProject('p001', transactions, [])).toBe(0);
	});

	it('returns zero when no allocations target the project', () => {
		const allocations = [alloc('d1', 'other', 100000)];
		expect(raisedForProject('p001', transactions, allocations)).toBe(0);
	});
});
