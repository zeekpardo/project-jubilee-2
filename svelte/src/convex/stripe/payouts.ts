// Working out what a payout was actually made of.
//
// A `payout.*` webhook carries ONE number: the net that leaves the Stripe
// balance for the bank. It does not say which gifts it settled, what Stripe
// took, or whether a refund ate into it. That breakdown is not withheld — it
// genuinely does not exist on the event. It lives in the BALANCE TRANSACTIONS
// the payout settled, on the CONNECTED account, and the only way to get it is
// to list them and add them up. That is this file.
//
// Which is also why an org cannot answer "where did our money go" from Stripe's
// payout list alone, and why a nonprofit's bookkeeper otherwise reconciles a
// bank deposit against a donation report by hand, in a spreadsheet, monthly.
//
// The arithmetic is deliberately NOT forced to balance. `grossCents` and
// `feeCents` describe the DONATIONS in the payout; a payout also settles
// refunds, disputes and adjustments, and `otherCents` carries those so the
// three columns can disagree with `amountCents` honestly rather than by a
// fudge. See the note on `stripePayouts` in `schema.ts`.

import { v } from 'convex/values';
import type Stripe from 'stripe';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { stripeClient } from './client';

/** Stripe's own ceiling for this endpoint. Fewer round trips is strictly better. */
const PAGE_SIZE = 100;

/**
 * A payout of two thousand donations is already far outside what this product
 * sees, and an unbounded `while (has_more)` against someone else's API is how
 * an action runs until Convex kills it. Hitting this logs loudly rather than
 * silently reporting a short total as if it were complete.
 */
const MAX_PAGES = 20;

/** How many gift rows one stamping mutation may patch. Keeps each transaction small. */
const STAMP_CHUNK = 100;

// ------------------------------------------------------------
// Reading the breakdown out of Stripe
// ------------------------------------------------------------

/**
 * A balance transaction's `source`, reduced to the two ids that identify a gift.
 *
 * Read structurally rather than through `Stripe.BalanceTransaction.Source`,
 * which is a union of nine object types that share almost nothing — narrowing
 * it properly would mean nine cases to learn that a charge has an id.
 *
 * `payment_intent` is the field that matters. `donationIntents` has a unique
 * index on it and none on `stripeChargeId`, so the payment intent is the only
 * BOUNDED way home from a settled charge — see `stampGiftsWithPayout`.
 */
function giftIdentity(source: Stripe.BalanceTransaction['source']): {
	chargeId?: string;
	paymentIntentId?: string;
} {
	if (!source) return {};
	// Unexpanded: the id is all we get, and it is not enough to find the gift.
	if (typeof source === 'string') return { chargeId: source };

	const charge = source as { id?: string; payment_intent?: string | { id: string } | null };
	const paymentIntent = charge.payment_intent;
	return {
		chargeId: charge.id,
		paymentIntentId:
			typeof paymentIntent === 'string' ? paymentIntent : (paymentIntent?.id ?? undefined)
	};
}

/**
 * Whether a balance transaction is the payout's own row rather than something
 * the payout settled.
 *
 * Stripe includes the payout's own balance transaction in this list, and it is
 * the exact negative of everything else in it. Counted as "other" it would
 * drive `gross - fee + other` to zero on every payout — a number that is always
 * correct and never means anything. Excluded, that expression lands back on
 * `amountCents`, which is the identity a finance person can actually check.
 */
function isPayoutItself(type: string): boolean {
	return type === 'payout' || type === 'payout_cancel' || type === 'payout_failure';
}

type PayoutBreakdown = {
	grossCents: number;
	feeCents: number;
	otherCents: number;
	/** Payment intents to stamp, deduped — a charge cannot settle twice. */
	paymentIntentIds: string[];
	/** Charges counted toward gross, whether or not we hold a gift row for them. */
	donationCount: number;
	transactionCount: number;
	truncated: boolean;
};

/**
 * Pages the whole payout and adds it up.
 *
 * The empty params object is NOT decorative and neither is the argument order:
 * with two arguments this SDK reads the second as PARAMS, which silently drops
 * the `Stripe-Account` header and 404s the call against the platform account.
 * Request options are the THIRD argument whenever params are present. The same
 * trap is documented at the balance-transaction read in `events.ts`.
 */
async function readBreakdown(
	stripeAccountId: string,
	stripePayoutId: string
): Promise<PayoutBreakdown> {
	const stripe = stripeClient();

	let grossCents = 0;
	let feeCents = 0;
	let otherCents = 0;
	let donationCount = 0;
	let transactionCount = 0;
	let truncated = false;

	const paymentIntentIds = new Set<string>();
	let startingAfter: string | undefined;

	for (let page = 0; page < MAX_PAGES; page += 1) {
		const batch = await stripe.balanceTransactions.list(
			{
				payout: stripePayoutId,
				limit: PAGE_SIZE,
				starting_after: startingAfter,
				// The charge arrives with its transaction rather than as another
				// round trip per donation — and it is the charge that carries the
				// payment intent we resolve gifts by. `giftIdentity` still copes
				// with an unexpanded response; it just cannot find the gift.
				expand: ['data.source']
			},
			{ stripeAccount: stripeAccountId }
		);

		for (const transaction of batch.data) {
			transactionCount += 1;

			// 'charge' is a card gift, 'payment' is the same thing arriving through
			// a non-card method. Both are donations; nothing else in the list is.
			if (transaction.type === 'charge' || transaction.type === 'payment') {
				grossCents += transaction.amount;
				feeCents += transaction.fee;
				donationCount += 1;

				const { paymentIntentId } = giftIdentity(transaction.source);
				if (paymentIntentId) paymentIntentIds.add(paymentIntentId);
				continue;
			}

			if (isPayoutItself(transaction.type)) continue;

			// Refunds, disputes, adjustments, standalone Stripe fees. `net` rather
			// than `amount` because what these did to the payout is the whole
			// movement including its own fee, not the headline figure.
			otherCents += transaction.net;
		}

		if (!batch.has_more) break;

		startingAfter = batch.data[batch.data.length - 1]?.id;
		// `has_more` with an empty page should be impossible; paging on a missing
		// cursor would re-request page one until the action is killed.
		if (!startingAfter) break;

		if (page === MAX_PAGES - 1) truncated = true;
	}

	return {
		grossCents,
		feeCents,
		otherCents,
		paymentIntentIds: [...paymentIntentIds],
		donationCount,
		transactionCount,
		truncated
	};
}

// ------------------------------------------------------------
// The action
// ------------------------------------------------------------

/**
 * Fills in the breakdown behind one payout, and links its donations to it.
 *
 * Scheduled from the `payout.*` handler once the payout is `paid` — before that
 * the balance transactions are not attached and there is nothing to read.
 *
 * Safe to run again, by design rather than by luck. Every figure is recomputed
 * from Stripe and overwritten, and the stamp on a gift row is set to the value
 * it already holds. A sweep re-reconciling last month's payouts would change
 * nothing, which is what makes it safe to write one.
 *
 * The one thing it will not do is write zeroes. A payout that comes back with
 * no balance transactions at all — reconciled too early, or read against the
 * wrong account — leaves the existing columns alone, because "we could not see
 * it" and "it contained nothing" are not the same statement and only one of
 * them is worth showing a nonprofit.
 */
export const reconcilePayout = internalAction({
	args: { stripeAccountId: v.string(), stripePayoutId: v.string() },
	handler: async (
		ctx,
		args
	): Promise<{ reconciled: boolean; donationCount: number; stamped: number }> => {
		const payout: Doc<'stripePayouts'> | null = await ctx.runQuery(
			internal.stripe.payouts.getPayoutByStripeId,
			{ stripePayoutId: args.stripePayoutId }
		);
		// A payout we never recorded. `recordPayout` ignores accounts we do not
		// know, so this is the same "not ours to explain" case arriving later.
		if (!payout) {
			console.error(`No payout row for ${args.stripePayoutId}; nothing to reconcile`);
			return { reconciled: false, donationCount: 0, stamped: 0 };
		}

		const breakdown = await readBreakdown(args.stripeAccountId, args.stripePayoutId);

		if (breakdown.truncated) {
			console.error(
				`Payout ${args.stripePayoutId} has more than ${MAX_PAGES * PAGE_SIZE} balance ` +
					`transactions; totals below are a partial sum of the first ${breakdown.transactionCount}`
			);
		}

		if (breakdown.transactionCount === 0) {
			console.info(
				`Payout ${args.stripePayoutId} settled no balance transactions yet; leaving it unreconciled`
			);
			return { reconciled: false, donationCount: 0, stamped: 0 };
		}

		// Gifts first, totals last. `reconciledAt` is then a truthful "this payout
		// has been fully explained" rather than a flag that can be set while half
		// its donations are still unlinked.
		let stamped = 0;
		for (let i = 0; i < breakdown.paymentIntentIds.length; i += STAMP_CHUNK) {
			const result: { stamped: number } = await ctx.runMutation(
				internal.stripe.payouts.stampGiftsWithPayout,
				{
					stripePayoutId: args.stripePayoutId,
					paymentIntentIds: breakdown.paymentIntentIds.slice(i, i + STAMP_CHUNK)
				}
			);
			stamped += result.stamped;
		}

		await ctx.runMutation(internal.stripe.payouts.commitPayoutBreakdown, {
			stripePayoutId: args.stripePayoutId,
			grossCents: breakdown.grossCents,
			feeCents: breakdown.feeCents,
			otherCents: breakdown.otherCents,
			donationCount: breakdown.donationCount
		});

		return { reconciled: true, donationCount: breakdown.donationCount, stamped };
	}
});

// ------------------------------------------------------------
// Commits
// ------------------------------------------------------------

export const getPayoutByStripeId = internalQuery({
	args: { stripePayoutId: v.string() },
	handler: async (ctx, args): Promise<Doc<'stripePayouts'> | null> => {
		return await ctx.db
			.query('stripePayouts')
			.withIndex('by_stripePayoutId', (q) => q.eq('stripePayoutId', args.stripePayoutId))
			.unique();
	}
});

/**
 * Links settled gifts to the payout that paid them.
 *
 * Resolved by PAYMENT INTENT, not by charge id, and that is a constraint rather
 * than a preference: `by_stripePaymentIntentId` is a unique index and there is
 * no index on `stripeChargeId`, so matching on the charge would mean scanning
 * the org's donations for every payout. The charge id is still what Stripe
 * gives us — the expanded `source` in `readBreakdown` is what turns it into the
 * payment intent, which is precisely why that expansion is asked for.
 *
 * The account check is not paranoia about Stripe. It is the guard that keeps a
 * payment intent id — which is not a secret — from stamping one org's payout id
 * onto another org's donation, and it is what `listPayoutDonations` relies on
 * being true.
 */
export const stampGiftsWithPayout = internalMutation({
	args: {
		stripePayoutId: v.string(),
		paymentIntentIds: v.array(v.string())
	},
	handler: async (ctx, args): Promise<{ stamped: number }> => {
		const payout = await ctx.db
			.query('stripePayouts')
			.withIndex('by_stripePayoutId', (q) => q.eq('stripePayoutId', args.stripePayoutId))
			.unique();
		if (!payout) return { stamped: 0 };

		let stamped = 0;
		for (const stripePaymentIntentId of args.paymentIntentIds) {
			const intent = await ctx.db
				.query('donationIntents')
				.withIndex('by_stripePaymentIntentId', (q) =>
					q.eq('stripePaymentIntentId', stripePaymentIntentId)
				)
				.unique();
			// A charge in the payout that is not one of ours. An org can take money
			// through its own Stripe account by other means, and that money is
			// still in the payout — it is counted in `grossCents` and simply has no
			// gift row to point at.
			if (!intent) continue;
			if (intent.stripeAccountId !== payout.stripeAccountId) continue;

			// Already stamped by an earlier run. Skipped rather than re-patched so
			// a re-reconciliation writes nothing at all.
			if (intent.stripePayoutId === args.stripePayoutId) {
				stamped += 1;
				continue;
			}

			await ctx.db.patch('donationIntents', intent._id, {
				stripePayoutId: args.stripePayoutId
			});
			stamped += 1;
		}

		return { stamped };
	}
});

/**
 * Writes the totals, and stamps the payout as explained.
 *
 * Last step of the reconciliation on purpose — see `reconcilePayout`.
 */
export const commitPayoutBreakdown = internalMutation({
	args: {
		stripePayoutId: v.string(),
		grossCents: v.number(),
		feeCents: v.number(),
		otherCents: v.number(),
		donationCount: v.number()
	},
	handler: async (ctx, args) => {
		const payout = await ctx.db
			.query('stripePayouts')
			.withIndex('by_stripePayoutId', (q) => q.eq('stripePayoutId', args.stripePayoutId))
			.unique();
		if (!payout) return null;

		await ctx.db.patch('stripePayouts', payout._id, {
			grossCents: args.grossCents,
			feeCents: args.feeCents,
			otherCents: args.otherCents,
			donationCount: args.donationCount,
			reconciledAt: Date.now()
		});
		return null;
	}
});
