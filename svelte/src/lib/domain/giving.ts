// Pure giving math — no db imports, no Stripe SDK.
//
// Shared by the donation form and by the action that creates the
// PaymentIntent, and it has to be literally the same code in both places. The
// donor consents to a specific number; if the form computes one total and the
// server charges another, the donor was shown a figure they did not agree to
// pay. Two implementations of this formula would drift the first time either
// side rounded differently.
//
// The server still recomputes from its own copy of the org's rate — the
// client's figure is a display hint and nothing more — but both run this.

/** Stripe rejects charges under 50¢, so there is no point in accepting them. */
export const MIN_GIFT_CENTS = 100;

/**
 * A ceiling so a fat-fingered or hostile amount fails fast rather than
 * becoming a seven-figure authorization and a support incident. A real major
 * gift this size should be arranged with the nonprofit directly, which is what
 * they would want anyway.
 */
export const MAX_GIFT_CENTS = 100_000_00;

/**
 * Below this, fee-cover is not offered. The fixed 30¢ dominates and the load
 * gets embarrassing: at $5.00 net the donor would be asked for $5.42 — 8.4% —
 * which reads as a surcharge rather than as generosity.
 */
export const MIN_FEE_COVER_CENTS = 1000;

/**
 * What to charge so the org nets what the donor intended.
 *
 * Adding the fee naively undercharges, because the amount added is itself
 * charged a fee. Solving `gross - (gross × rate + fixed) = net` gives
 * `gross = (net + fixed) / (1 - rate)`.
 *
 * Rounds UP, always. Rounding down leaves the org a cent short, and a cent
 * short on a $10,000 gift costs more to explain than it does to absorb.
 */
export function grossUpForFees(netCents: number, rate: number, fixedCents: number): number {
	if (!Number.isInteger(netCents)) {
		throw new Error('Gift amount must be an integer number of cents');
	}
	if (!(rate >= 0 && rate < 1)) {
		throw new Error('Fee rate must be at least 0 and below 100%');
	}
	if (!Number.isInteger(fixedCents) || fixedCents < 0) {
		throw new Error('Fixed fee must be a non-negative integer number of cents');
	}
	return Math.ceil((netCents + fixedCents) / (1 - rate));
}

/**
 * Our cut of a charge, in cents.
 *
 * Zero basis points returns exactly zero rather than a rounded fraction, so
 * callers can omit `application_fee_amount` entirely — Stripe treats an absent
 * application fee differently from a zero one on some paths.
 */
export function platformFeeCents(chargedCents: number, platformFeeBps: number): number {
	if (platformFeeBps <= 0) return 0;
	return Math.round((chargedCents * platformFeeBps) / 10_000);
}

export type GiftAmounts = {
	intendedCents: number;
	chargedCents: number;
	coverFees: boolean;
	platformFeeCents: number;
};

/**
 * The amount actually charged for a gift, and the components behind it.
 *
 * One function rather than a gross-up at each call site, because every surface
 * that shows the donor a total — the form, the confirmation, the receipt —
 * has to agree with what Stripe was told.
 *
 * Fee-cover on a small gift is silently declined rather than rejected: the
 * donor asked to be generous, and answering that with a form validation error
 * would be a strange way to respond.
 */
export function computeGiftAmounts(input: {
	intendedCents: number;
	coverFees: boolean;
	feeRate: number;
	feeFixedCents: number;
	platformFeeBps: number;
}): GiftAmounts {
	const coverFees = input.coverFees && input.intendedCents >= MIN_FEE_COVER_CENTS;

	const chargedCents = coverFees
		? grossUpForFees(input.intendedCents, input.feeRate, input.feeFixedCents)
		: input.intendedCents;

	return {
		intendedCents: input.intendedCents,
		chargedCents,
		coverFees,
		platformFeeCents: platformFeeCents(chargedCents, input.platformFeeBps)
	};
}

export type RefundPlan = {
	/** What the org keeps. Zero means the whole gift came back. */
	remainingCents: number;
	/** How much was refunded in total, clamped to what was actually charged. */
	refundedCents: number;
	/** Whether the ledger transaction and its allocations should be removed. */
	removeTransaction: boolean;
	/**
	 * New amount for each allocation, positionally matching the input. A zero
	 * means that allocation should be deleted.
	 */
	allocationCents: number[];
};

/**
 * How a refund lands on the ledger.
 *
 * Extracted from the mutation and kept pure because this is money arithmetic
 * that has to be right, and it is far easier to be sure of it against a table
 * of cases than against a database.
 *
 * `refundedCents` is Stripe's CUMULATIVE `amount_refunded`, not the size of the
 * latest refund. Taking the running total is what makes applying this
 * idempotent: a redelivered `charge.refunded` recomputes the same end state
 * rather than subtracting twice.
 *
 * The partial case is the one worth being careful about. Stripe fires
 * `charge.refunded` for a $10 refund of a $100 gift exactly as it does for the
 * full amount, so treating the event as "this gift is gone" would erase ninety
 * dollars the nonprofit still holds.
 *
 * Allocations are drained in order rather than reduced proportionally. An
 * online gift always has exactly one allocation for its whole amount, so the
 * distinction only arises if a human has since split it in the admin UI —
 * and in that case taking the refund off the front is at least deterministic,
 * where a proportional split would have to invent a rounding rule.
 */
export function planRefund(input: {
	chargedCents: number;
	refundedCents: number;
	allocationCents: number[];
}): RefundPlan {
	const refundedCents = Math.max(0, Math.min(input.refundedCents, input.chargedCents));
	const remainingCents = input.chargedCents - refundedCents;

	if (remainingCents <= 0) {
		return {
			remainingCents: 0,
			refundedCents,
			removeTransaction: true,
			allocationCents: input.allocationCents.map(() => 0)
		};
	}

	let left = remainingCents;
	const allocationCents = input.allocationCents.map((amount) => {
		const next = Math.min(amount, left);
		left -= next;
		return next;
	});

	return { remainingCents, refundedCents, removeTransaction: false, allocationCents };
}

/** Whether an amount is one we can actually charge. Null when it is fine. */
export function giftAmountProblem(cents: number): 'invalid' | 'tooSmall' | 'tooLarge' | null {
	if (!Number.isInteger(cents)) return 'invalid';
	if (cents < MIN_GIFT_CENTS) return 'tooSmall';
	if (cents > MAX_GIFT_CENTS) return 'tooLarge';
	return null;
}
