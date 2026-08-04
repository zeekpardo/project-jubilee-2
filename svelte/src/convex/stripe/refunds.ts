// Giving a donation back.
//
// The whole flow is one action because refunding needs a network call, but the
// interesting parts are the two guards around it:
//
//   The gift is loaded by ID and its `orgId` checked against the CALLER's org,
//   derived from the session. Without that, a donation id — which is not a
//   secret, it rides in a URL on the thanks page — would let anyone with
//   `money:write` anywhere refund any org's charge, using our platform
//   credentials to do it. That is the cross-tenant hole this file exists to
//   not have.
//
//   The refundable amount is computed server-side from what we already know
//   was refunded. A client-supplied amount is a hint, never a budget.
//
// Note what a refund does NOT do: return Stripe's processing fee. The org is
// out that money regardless, which is worth saying plainly in the UI rather
// than letting a finance person discover it at reconciliation.

import { ConvexError, v } from 'convex/values';
import { action, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { stripeClient } from './client';
import { getAccess } from '../model/access';
import { can } from '../../lib/domain/permissions';

type RefundableGift = {
	donationIntentId: Id<'donationIntents'>;
	stripeAccountId: string;
	stripePaymentIntentId: string;
	chargedCents: number;
	alreadyRefundedCents: number;
	refundableCents: number;
};

/**
 * The gift, if the caller may refund it.
 *
 * Gated campaign-scoped: `money:write` is declared CAMPAIGN_SCOPED in the
 * permission matrix, and unlike a manual `transactions` row an online gift
 * knows exactly which campaign it belongs to — so it can be gated properly
 * rather than falling back to org-wide, which is what PLAN-stripe.md §12 notes
 * the manual path is stuck with.
 *
 * Everything about the caller comes from the session. The only argument is
 * which gift, and that is re-checked against the caller's org below.
 */
export const getRefundableGift = internalQuery({
	args: { donationIntentId: v.id('donationIntents') },
	handler: async (ctx, args): Promise<RefundableGift> => {
		const intent = await ctx.db.get('donationIntents', args.donationIntentId);
		// Same error for "does not exist" and "belongs to someone else", so this
		// cannot be used to probe which donation ids are real.
		if (!intent) throw new ConvexError('That donation could not be found.');

		const access = await getAccess(ctx);
		if (!access.orgId) throw new ConvexError('Not authenticated');
		if (intent.orgId !== access.orgId) {
			throw new ConvexError('That donation could not be found.');
		}
		if (!can(access, 'money:write', intent.campaignId)) {
			throw new ConvexError('Not permitted: money:write');
		}

		if (intent.status !== 'succeeded' && intent.status !== 'refunded') {
			// Nothing settled, nothing to give back. Refunding a `processing`
			// ACH debit is not a thing Stripe supports either.
			throw new ConvexError('Only a completed gift can be refunded.');
		}
		if (!intent.stripePaymentIntentId) {
			throw new ConvexError('That gift has no Stripe payment to refund.');
		}

		const alreadyRefundedCents = intent.refundedCents ?? 0;
		return {
			donationIntentId: intent._id,
			stripeAccountId: intent.stripeAccountId,
			stripePaymentIntentId: intent.stripePaymentIntentId,
			chargedCents: intent.chargedCents,
			alreadyRefundedCents,
			refundableCents: Math.max(0, intent.chargedCents - alreadyRefundedCents)
		};
	}
});

/**
 * Refunds a gift, in whole or in part.
 *
 * `amountCents` omitted means the full remaining balance, which is what the
 * common case wants and avoids the UI having to do the subtraction.
 *
 * The ledger is NOT written here. Stripe emits `charge.refunded` and the
 * webhook applies it, exactly as it would for a refund issued from the org's
 * own Stripe dashboard — which they can do, since they have a full dashboard.
 * Writing it here too would mean two paths to the same state and a race
 * between them; leaving it to the webhook means both routes converge on one
 * handler. The trade is that the admin table updates a beat later, which is
 * the correct trade for money.
 */
export const refundGift = action({
	args: {
		donationIntentId: v.id('donationIntents'),
		amountCents: v.optional(v.number()),
		reason: v.optional(
			v.union(v.literal('duplicate'), v.literal('fraudulent'), v.literal('requested_by_customer'))
		)
	},
	handler: async (ctx, args): Promise<{ refundedCents: number }> => {
		const gift = await ctx.runQuery(internal.stripe.refunds.getRefundableGift, {
			donationIntentId: args.donationIntentId
		});

		if (gift.refundableCents <= 0) {
			throw new ConvexError('That gift has already been fully refunded.');
		}

		const amountCents = args.amountCents ?? gift.refundableCents;
		if (!Number.isInteger(amountCents) || amountCents <= 0) {
			throw new ConvexError('Refund amount must be a positive number of cents.');
		}
		if (amountCents > gift.refundableCents) {
			throw new ConvexError(
				`That is more than the ${gift.refundableCents} cents still refundable on this gift.`
			);
		}

		await stripeClient().refunds.create(
			{
				payment_intent: gift.stripePaymentIntentId,
				amount: amountCents,
				reason: args.reason,
				// The application fee follows the refund proportionally. On a
				// zero-fee platform this is a no-op, but leaving it off would mean
				// that the day a fee IS switched on, we keep our cut of money the
				// donor got back.
				refund_application_fee: true
			},
			{
				// Acting as the connected account, because the charge lives there.
				stripeAccount: gift.stripeAccountId,
				// Scoped to the gift AND the running total, so a double-click
				// replays rather than refunding twice — while a genuine second
				// partial refund of the same gift gets its own key.
				idempotencyKey: `refund:${gift.donationIntentId}:${gift.alreadyRefundedCents}:${amountCents}`
			}
		);

		return { refundedCents: amountCents };
	}
});
