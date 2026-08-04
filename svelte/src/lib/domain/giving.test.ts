import { describe, expect, it } from 'vitest';
import {
	MAX_GIFT_CENTS,
	MIN_FEE_COVER_CENTS,
	computeGiftAmounts,
	giftAmountProblem,
	grossUpForFees,
	planRefund,
	platformFeeCents
} from './giving';

// The nonprofit rate, which is the one that actually matters — a hardcoded
// 2.9% would overcharge every donor of every discounted org.
const NONPROFIT_RATE = 0.022;
const FIXED = 30;

describe('grossUpForFees', () => {
	it('charges enough that the org nets exactly what the donor intended', () => {
		// The worked example from PLAN-stripe.md §9: donor wants the org to
		// receive $100.00 at 2.2% + 30¢.
		const gross = grossUpForFees(10000, NONPROFIT_RATE, FIXED);
		expect(gross).toBe(10256);

		// And the round trip actually closes, which is the whole point.
		const fee = Math.round(gross * NONPROFIT_RATE) + FIXED;
		expect(gross - fee).toBe(10000);
	});

	it('never leaves the org short, across a wide sweep of amounts', () => {
		// Rounding down by a cent is the failure this guards. It is invisible on
		// any single gift and produces a reconciliation ticket on a large one.
		for (let net = 100; net <= 100000; net += 137) {
			const gross = grossUpForFees(net, NONPROFIT_RATE, FIXED);
			const fee = Math.round(gross * NONPROFIT_RATE) + FIXED;
			expect(gross - fee).toBeGreaterThanOrEqual(net);
		}
	});

	it('rounds up rather than to nearest', () => {
		// (5000 + 30) / 0.978 = 5143.15..., which must not become 5143.
		expect(grossUpForFees(5000, NONPROFIT_RATE, FIXED)).toBe(5144);
	});

	it('is a no-op at a zero rate and zero fixed fee', () => {
		expect(grossUpForFees(2500, 0, 0)).toBe(2500);
	});

	it('rejects a rate at or above 100%, which would divide by zero or invert', () => {
		expect(() => grossUpForFees(1000, 1, FIXED)).toThrow();
		expect(() => grossUpForFees(1000, 1.5, FIXED)).toThrow();
	});

	it('rejects fractional cents', () => {
		expect(() => grossUpForFees(10.5, NONPROFIT_RATE, FIXED)).toThrow();
	});
});

describe('platformFeeCents', () => {
	it('is exactly zero at zero basis points, not a rounded fraction', () => {
		// Load-bearing: the caller omits `application_fee_amount` entirely when
		// this is 0, and Stripe treats absent differently from zero.
		expect(platformFeeCents(10256, 0)).toBe(0);
		expect(Object.is(platformFeeCents(10256, 0), 0)).toBe(true);
	});

	it('computes basis points against the charged amount', () => {
		expect(platformFeeCents(10000, 200)).toBe(200);
		expect(platformFeeCents(10256, 200)).toBe(205);
	});
});

describe('computeGiftAmounts', () => {
	const base = {
		feeRate: NONPROFIT_RATE,
		feeFixedCents: FIXED,
		platformFeeBps: 0
	};

	it('charges the intended amount when fees are not covered', () => {
		const amounts = computeGiftAmounts({ ...base, intendedCents: 5000, coverFees: false });
		expect(amounts.chargedCents).toBe(5000);
		expect(amounts.intendedCents).toBe(5000);
		expect(amounts.coverFees).toBe(false);
	});

	it('grosses up when fees are covered', () => {
		const amounts = computeGiftAmounts({ ...base, intendedCents: 10000, coverFees: true });
		expect(amounts.chargedCents).toBe(10256);
		expect(amounts.coverFees).toBe(true);
	});

	it('silently declines fee-cover below the floor rather than erroring', () => {
		// A donor asked to be generous on a $5 gift. The answer is no, but it is
		// not a validation failure — and critically, they are charged the $5
		// they picked, not $5.42.
		const amounts = computeGiftAmounts({
			...base,
			intendedCents: MIN_FEE_COVER_CENTS - 1,
			coverFees: true
		});
		expect(amounts.coverFees).toBe(false);
		expect(amounts.chargedCents).toBe(MIN_FEE_COVER_CENTS - 1);
	});

	it('applies fee-cover exactly at the floor', () => {
		const amounts = computeGiftAmounts({
			...base,
			intendedCents: MIN_FEE_COVER_CENTS,
			coverFees: true
		});
		expect(amounts.coverFees).toBe(true);
		expect(amounts.chargedCents).toBeGreaterThan(MIN_FEE_COVER_CENTS);
	});

	it('computes the platform fee from the CHARGED amount, not the intended one', () => {
		const amounts = computeGiftAmounts({
			...base,
			platformFeeBps: 200,
			intendedCents: 10000,
			coverFees: true
		});
		expect(amounts.chargedCents).toBe(10256);
		expect(amounts.platformFeeCents).toBe(205);
	});
});

describe('planRefund', () => {
	// The case that motivated extracting this. Stripe fires `charge.refunded`
	// for a partial refund exactly as it does for a full one, so treating the
	// event as "the gift is gone" erases money the nonprofit still holds.
	it('keeps the remainder on a partial refund', () => {
		const plan = planRefund({
			chargedCents: 10000,
			refundedCents: 1000,
			allocationCents: [10000]
		});
		expect(plan.remainingCents).toBe(9000);
		expect(plan.removeTransaction).toBe(false);
		expect(plan.allocationCents).toEqual([9000]);
	});

	it('removes the transaction only when nothing is left', () => {
		const plan = planRefund({
			chargedCents: 10000,
			refundedCents: 10000,
			allocationCents: [10000]
		});
		expect(plan.remainingCents).toBe(0);
		expect(plan.removeTransaction).toBe(true);
		expect(plan.allocationCents).toEqual([0]);
	});

	it('is idempotent, because refundedCents is a running total', () => {
		// A redelivered webhook must recompute the same end state, not subtract
		// a second time. This is the property the whole cumulative-amount choice
		// exists to get.
		const once = planRefund({ chargedCents: 10000, refundedCents: 2500, allocationCents: [10000] });
		const twice = planRefund({
			chargedCents: 10000,
			refundedCents: 2500,
			allocationCents: [10000]
		});
		expect(twice).toEqual(once);
	});

	it('handles refunds arriving in stages', () => {
		const first = planRefund({
			chargedCents: 10000,
			refundedCents: 3000,
			allocationCents: [10000]
		});
		expect(first.remainingCents).toBe(7000);
		// The second event reports the cumulative 5000, not another 2000.
		const second = planRefund({
			chargedCents: 10000,
			refundedCents: 5000,
			allocationCents: [first.allocationCents[0]]
		});
		expect(second.remainingCents).toBe(5000);
		expect(second.allocationCents).toEqual([5000]);
	});

	it('clamps a refund larger than the charge rather than going negative', () => {
		const plan = planRefund({
			chargedCents: 5000,
			refundedCents: 9999,
			allocationCents: [5000]
		});
		expect(plan.refundedCents).toBe(5000);
		expect(plan.remainingCents).toBe(0);
		expect(plan.removeTransaction).toBe(true);
	});

	it('drains split allocations in order and never leaves a negative one', () => {
		// Only reachable if a human split the gift's allocation in the admin UI.
		const plan = planRefund({
			chargedCents: 10000,
			refundedCents: 7000,
			allocationCents: [6000, 4000]
		});
		expect(plan.allocationCents).toEqual([3000, 0]);
		// The invariant that matters: allocations never exceed the transaction.
		const total = plan.allocationCents.reduce((sum, amount) => sum + amount, 0);
		expect(total).toBe(plan.remainingCents);
	});

	it('preserves sum(allocations) <= remaining across a sweep', () => {
		for (let refunded = 0; refunded <= 10000; refunded += 137) {
			const plan = planRefund({
				chargedCents: 10000,
				refundedCents: refunded,
				allocationCents: [7000, 3000]
			});
			const total = plan.allocationCents.reduce((sum, amount) => sum + amount, 0);
			expect(total).toBeLessThanOrEqual(plan.remainingCents);
			expect(plan.allocationCents.every((amount) => amount >= 0)).toBe(true);
		}
	});

	it('treats a zero refund as a no-op that keeps everything', () => {
		const plan = planRefund({ chargedCents: 10000, refundedCents: 0, allocationCents: [10000] });
		expect(plan.remainingCents).toBe(10000);
		expect(plan.removeTransaction).toBe(false);
		expect(plan.allocationCents).toEqual([10000]);
	});
});

describe('giftAmountProblem', () => {
	it('accepts an ordinary gift', () => {
		expect(giftAmountProblem(5000)).toBeNull();
	});

	it('rejects amounts below the floor, including zero and negatives', () => {
		expect(giftAmountProblem(99)).toBe('tooSmall');
		expect(giftAmountProblem(0)).toBe('tooSmall');
		expect(giftAmountProblem(-5000)).toBe('tooSmall');
	});

	it('rejects amounts above the ceiling', () => {
		expect(giftAmountProblem(MAX_GIFT_CENTS + 1)).toBe('tooLarge');
	});

	it('rejects fractional and non-finite amounts', () => {
		expect(giftAmountProblem(50.5)).toBe('invalid');
		expect(giftAmountProblem(Number.NaN)).toBe('invalid');
		expect(giftAmountProblem(Number.POSITIVE_INFINITY)).toBe('invalid');
	});
});
