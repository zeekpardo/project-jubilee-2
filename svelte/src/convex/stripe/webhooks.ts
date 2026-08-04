// The internal mutations a Stripe webhook commits through.
//
// Delivery is AT LEAST ONCE and unordered. Both facts are handled here rather
// than wished away:
//
//   `recordEvent` dedupes on `event.id`, but only against events that were
//   actually HANDLED. An event that was recorded and then failed mid-handler
//   must be allowed to run again, or a transient error becomes permanent data
//   loss with a 200 already returned to Stripe.
//
//   Every handler is written to be safe to re-run. That is cheaper and more
//   honest than trying to guarantee exactly-once delivery, which is not on
//   offer.
//
// Nothing here reads `event.metadata` to decide which org a payment belongs
// to. Connected-account admins can edit metadata in their own dashboards, so
// it is a debugging aid, never an authorization input. The org comes from the
// account id, resolved against our own table.

import { ConvexError, v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { internalMutation } from '../functions';
import type { MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { accountByStripeId } from '../model/stripe';
import { reverseGiftInLedger, writeGiftToLedger } from '../model/donations';

// ------------------------------------------------------------
// Delivery bookkeeping
// ------------------------------------------------------------

/**
 * Claims an event for handling, or reports that it is already done.
 *
 * Returns `shouldHandle: false` only when a previous delivery ran a handler
 * to completion. A row with no `handledAt` is either in flight or previously
 * failed, and in both cases re-running is the right answer — every handler in
 * this file is idempotent, so the cost of a double run is nothing and the cost
 * of skipping is a lost donation.
 */
export const recordEvent = internalMutation({
	args: {
		stripeEventId: v.string(),
		type: v.string(),
		stripeAccountId: v.optional(v.string()),
		livemode: v.boolean(),
		createdAt: v.number()
	},
	handler: async (ctx, args): Promise<{ shouldHandle: boolean }> => {
		const existing = await ctx.db
			.query('stripeEvents')
			.withIndex('by_stripeEventId', (q) => q.eq('stripeEventId', args.stripeEventId))
			.unique();

		if (existing) {
			return { shouldHandle: existing.handledAt === undefined };
		}

		await ctx.db.insert('stripeEvents', {
			stripeEventId: args.stripeEventId,
			type: args.type,
			stripeAccountId: args.stripeAccountId,
			livemode: args.livemode,
			createdAt: args.createdAt,
			receivedAt: Date.now()
		});
		return { shouldHandle: true };
	}
});

export const markEventHandled = internalMutation({
	args: { stripeEventId: v.string() },
	handler: async (ctx, args) => {
		const event = await ctx.db
			.query('stripeEvents')
			.withIndex('by_stripeEventId', (q) => q.eq('stripeEventId', args.stripeEventId))
			.unique();
		if (!event) return null;
		await ctx.db.patch('stripeEvents', event._id, { handledAt: Date.now(), error: undefined });
		return null;
	}
});

/**
 * Records why a handler failed, leaving `handledAt` unset so the retry — from
 * Stripe, or from the reconciliation sweep — picks it up again.
 */
export const markEventFailed = internalMutation({
	args: { stripeEventId: v.string(), error: v.string() },
	handler: async (ctx, args) => {
		const event = await ctx.db
			.query('stripeEvents')
			.withIndex('by_stripeEventId', (q) => q.eq('stripeEventId', args.stripeEventId))
			.unique();
		if (!event) return null;
		await ctx.db.patch('stripeEvents', event._id, { error: args.error.slice(0, 1000) });
		return null;
	}
});

// ------------------------------------------------------------
// Gift lifecycle
// ------------------------------------------------------------

/**
 * Every gift handler starts here, and none of them resolve by metadata.
 * `by_stripePaymentIntentId` is a unique index, so `.unique()` is the correct
 * read — two rows for one payment intent would be a bug worth throwing on
 * rather than silently taking the first.
 */
async function giftByPaymentIntent(
	ctx: { db: MutationCtx['db'] },
	stripePaymentIntentId: string
): Promise<Doc<'donationIntents'> | null> {
	return await ctx.db
		.query('donationIntents')
		.withIndex('by_stripePaymentIntentId', (q) =>
			q.eq('stripePaymentIntentId', stripePaymentIntentId)
		)
		.unique();
}

export const getGiftByPaymentIntent = internalQuery({
	args: { stripePaymentIntentId: v.string() },
	handler: async (ctx, args): Promise<Doc<'donationIntents'> | null> => {
		return await ctx.db
			.query('donationIntents')
			.withIndex('by_stripePaymentIntentId', (q) =>
				q.eq('stripePaymentIntentId', args.stripePaymentIntentId)
			)
			.unique();
	}
});

/**
 * Creates the pending row BEFORE the PaymentIntent exists at Stripe.
 *
 * Order matters: our id is what the PaymentIntent's idempotency key is built
 * from, and it is what the return URL carries. Creating the Stripe object
 * first and then failing to write our row would produce a charge with nothing
 * on our side to attach it to.
 *
 * `pending` is not money and never reaches the ledger.
 */
export const createPendingGift = internalMutation({
	args: {
		orgId: v.string(),
		campaignId: v.id('campaigns'),
		projectId: v.optional(v.id('projects')),
		stripeAccountId: v.string(),
		intendedCents: v.number(),
		chargedCents: v.number(),
		coverFees: v.boolean(),
		platformFeeCents: v.optional(v.number()),
		donorName: v.optional(v.string()),
		donorEmail: v.optional(v.string()),
		anonymous: v.boolean(),
		designation: v.optional(v.string()),
		dedicationType: v.optional(v.union(v.literal('honor'), v.literal('memory'))),
		dedicationName: v.optional(v.string()),
		message: v.optional(v.string()),
		recurringGiftId: v.optional(v.id('recurringGifts'))
	},
	handler: async (ctx, args): Promise<Id<'donationIntents'>> => {
		return await ctx.db.insert('donationIntents', {
			...args,
			status: 'pending'
		});
	}
});

export const attachPaymentIntent = internalMutation({
	args: {
		donationIntentId: v.id('donationIntents'),
		stripePaymentIntentId: v.string()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch('donationIntents', args.donationIntentId, {
			stripePaymentIntentId: args.stripePaymentIntentId
		});
		return null;
	}
});

/**
 * The primary success path: money moved, so the ledger gets written.
 *
 * Schedules the acknowledgment email rather than sending it inline, because a
 * mutation cannot make a network call and because a mail failure must never
 * roll back a recorded gift.
 */
export const recordGiftSucceeded = internalMutation({
	args: { stripePaymentIntentId: v.string() },
	handler: async (ctx, args): Promise<{ handled: boolean }> => {
		const intent = await giftByPaymentIntent(ctx, args.stripePaymentIntentId);
		if (!intent) return { handled: false };

		const { alreadyWritten } = await writeGiftToLedger(ctx, intent);
		if (alreadyWritten) return { handled: true };

		await ctx.scheduler.runAfter(0, internal.stripe.receipts.sendAcknowledgment, {
			donationIntentId: intent._id
		});
		return { handled: true };
	}
});

/**
 * ACH in flight. Recorded so the donor's thanks page can say something true,
 * and pointedly NOT written to the ledger — a bank debit can still fail days
 * later, and a receipt issued now would have to be retracted.
 */
export const recordGiftProcessing = internalMutation({
	args: { stripePaymentIntentId: v.string() },
	handler: async (ctx, args) => {
		const intent = await giftByPaymentIntent(ctx, args.stripePaymentIntentId);
		// Never walk a settled gift backwards: `charge.succeeded` and
		// `payment_intent.processing` can arrive in either order.
		if (!intent || intent.status !== 'pending') return null;
		await ctx.db.patch('donationIntents', intent._id, { status: 'processing' });
		return null;
	}
});

export const recordGiftFailed = internalMutation({
	args: { stripePaymentIntentId: v.string(), failureMessage: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const intent = await giftByPaymentIntent(ctx, args.stripePaymentIntentId);
		if (!intent || intent.status === 'succeeded') return null;
		await ctx.db.patch('donationIntents', intent._id, {
			status: 'failed',
			failureMessage: args.failureMessage?.slice(0, 500)
		});
		return null;
	}
});

/**
 * The real fee numbers, which only exist once a balance transaction does.
 *
 * Separate from the success path because they arrive separately — sometimes on
 * `charge.succeeded`, sometimes not until a later `charge.updated`. Until then
 * `netCents` is genuinely unknown, which is why it is optional on the row
 * rather than defaulted to something plausible.
 */
export const recordGiftFees = internalMutation({
	args: {
		stripePaymentIntentId: v.string(),
		stripeChargeId: v.optional(v.string()),
		stripeFeeCents: v.optional(v.number()),
		platformFeeCents: v.optional(v.number()),
		netCents: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const intent = await giftByPaymentIntent(ctx, args.stripePaymentIntentId);
		if (!intent) return null;

		await ctx.db.patch('donationIntents', intent._id, {
			stripeChargeId: args.stripeChargeId ?? intent.stripeChargeId,
			stripeFeeCents: args.stripeFeeCents ?? intent.stripeFeeCents,
			platformFeeCents: args.platformFeeCents ?? intent.platformFeeCents,
			netCents: args.netCents ?? intent.netCents
		});
		return null;
	}
});

/**
 * A refund or a dispute: the ledger comes back out, in whole or in part.
 *
 * `refundedCents` is Stripe's CUMULATIVE `amount_refunded`, which is what
 * makes this safe to re-run — a redelivery recomputes the same end state
 * rather than subtracting a second time. The early return compares that total
 * rather than only the status, because a gift refunded twice in stages is
 * already `refunded` after the first and must still be reduced again.
 *
 * Also corrects the tax acknowledgment. A donor holding a written
 * acknowledgment for money they got back is not a cosmetic problem: it is a
 * deduction they are not entitled to, on a document the nonprofit issued.
 */
export const recordGiftReversed = internalMutation({
	args: {
		stripePaymentIntentId: v.string(),
		status: v.union(v.literal('refunded'), v.literal('disputed')),
		refundedCents: v.number()
	},
	handler: async (ctx, args) => {
		const intent = await giftByPaymentIntent(ctx, args.stripePaymentIntentId);
		if (!intent) return null;

		const alreadyRefunded = intent.refundedCents ?? 0;
		if (intent.status === args.status && alreadyRefunded >= args.refundedCents) return null;

		await reverseGiftInLedger(ctx, intent, args.status, args.refundedCents);

		// Only worth an email if the donor was ever sent a receipt. A gift
		// refunded before its acknowledgment went out needs no correction, and
		// `voidAcknowledgment` checks that for itself.
		await ctx.scheduler.runAfter(0, internal.stripe.receipts.voidAcknowledgment, {
			donationIntentId: intent._id,
			reason: args.status,
			remainingCents: Math.max(0, intent.chargedCents - args.refundedCents)
		});
		return null;
	}
});

// ------------------------------------------------------------
// Payouts and disputes
// ------------------------------------------------------------

/**
 * Money moving from the org's Stripe balance to their bank.
 *
 * Upserted by payout id, because Stripe reports the same payout several times
 * as it moves `pending` → `in_transit` → `paid`, and each delivery is the
 * current truth rather than an increment.
 */
export const recordPayout = internalMutation({
	args: {
		stripeAccountId: v.string(),
		stripePayoutId: v.string(),
		amountCents: v.number(),
		currency: v.string(),
		status: v.union(
			v.literal('pending'),
			v.literal('in_transit'),
			v.literal('paid'),
			v.literal('canceled'),
			v.literal('failed')
		),
		arrivalDate: v.optional(v.number()),
		failureCode: v.optional(v.string()),
		failureMessage: v.optional(v.string()),
		statementDescriptor: v.optional(v.string()),
		createdAt: v.number()
	},
	handler: async (ctx, args) => {
		const account = await accountByStripeId(ctx, args.stripeAccountId);
		// A payout on an account we do not know about. Nothing to attribute it
		// to, and metadata is not an acceptable substitute for the account id.
		if (!account) return null;

		const { stripeAccountId: _account, ...fields } = args;
		const existing = await ctx.db
			.query('stripePayouts')
			.withIndex('by_stripePayoutId', (q) => q.eq('stripePayoutId', args.stripePayoutId))
			.unique();

		if (existing) {
			await ctx.db.patch('stripePayouts', existing._id, fields);
			return null;
		}

		await ctx.db.insert('stripePayouts', {
			orgId: account.orgId,
			stripeAccountId: args.stripeAccountId,
			...fields
		});
		return null;
	}
});

/**
 * A dispute, and the deadline attached to it.
 *
 * Upserted by dispute id for the same reason payouts are: a dispute is
 * reported again on every status change, all the way to `won` or `lost`.
 *
 * Linked back to the gift where we can, so admin can show which donation is
 * being clawed back rather than an opaque charge id.
 */
export const recordDispute = internalMutation({
	args: {
		stripeAccountId: v.string(),
		stripeDisputeId: v.string(),
		stripeChargeId: v.string(),
		stripePaymentIntentId: v.optional(v.string()),
		amountCents: v.number(),
		currency: v.string(),
		reason: v.string(),
		status: v.string(),
		evidenceDueBy: v.optional(v.number()),
		createdAt: v.number()
	},
	handler: async (ctx, args) => {
		const account = await accountByStripeId(ctx, args.stripeAccountId);
		if (!account) return null;

		const intent = args.stripePaymentIntentId
			? await giftByPaymentIntent(ctx, args.stripePaymentIntentId)
			: null;

		const { stripeAccountId: _account, ...fields } = args;
		const existing = await ctx.db
			.query('stripeDisputes')
			.withIndex('by_stripeDisputeId', (q) => q.eq('stripeDisputeId', args.stripeDisputeId))
			.unique();

		if (existing) {
			await ctx.db.patch('stripeDisputes', existing._id, {
				...fields,
				donationIntentId: intent?._id ?? existing.donationIntentId
			});
			return null;
		}

		await ctx.db.insert('stripeDisputes', {
			orgId: account.orgId,
			stripeAccountId: args.stripeAccountId,
			donationIntentId: intent?._id,
			...fields
		});
		return null;
	}
});

// ------------------------------------------------------------
// Account lifecycle
// ------------------------------------------------------------

/**
 * The org disconnected us, or Stripe disconnected them.
 *
 * Two things have to happen and only one is obvious. Marking the account
 * restricted switches off the donation form. Cancelling the recurring gifts is
 * the part that is easy to miss and expensive to miss: Stripe does NOT cancel
 * subscriptions when an account is deauthorized, and
 * `application_fee_percent` keeps applying on direct charges. Without this we
 * would keep charging donors monthly on behalf of an organization that has
 * left, and keep taking a cut of it.
 *
 * Only the local rows are updated here. The subscriptions themselves have to
 * be cancelled through the API, which is scheduled as an action — and which
 * may well fail, because we may no longer have access to that account. That is
 * exactly why the local state is switched off first rather than second.
 */
export const recordDeauthorized = internalMutation({
	args: { stripeAccountId: v.string() },
	handler: async (ctx, args) => {
		const account = await accountByStripeId(ctx, args.stripeAccountId);
		if (!account) return null;

		await ctx.db.patch('stripeAccounts', account._id, {
			status: 'restricted',
			chargesEnabled: false,
			payoutsEnabled: false,
			lastSyncedAt: Date.now()
		});

		const active = await ctx.db
			.query('recurringGifts')
			.withIndex('by_orgId_and_status', (q) => q.eq('orgId', account.orgId).eq('status', 'active'))
			.take(200);

		for (const gift of active) {
			await ctx.db.patch('recurringGifts', gift._id, { status: 'canceled' });
		}

		// A pledge with no subscription id never got past the card form, so
		// there is nothing at Stripe to cancel.
		const subscriptionIds = active
			.map((gift) => gift.stripeSubscriptionId)
			.filter((id): id is string => id !== undefined);

		if (subscriptionIds.length > 0) {
			await ctx.scheduler.runAfter(0, internal.stripe.recurring.cancelSubscriptionsForAccount, {
				stripeAccountId: args.stripeAccountId,
				subscriptionIds
			});
		}
		return null;
	}
});

// ------------------------------------------------------------
// Recurring
// ------------------------------------------------------------

export const getRecurringBySubscription = internalQuery({
	args: { stripeSubscriptionId: v.string() },
	handler: async (ctx, args): Promise<Doc<'recurringGifts'> | null> => {
		return await ctx.db
			.query('recurringGifts')
			.withIndex('by_stripeSubscriptionId', (q) =>
				q.eq('stripeSubscriptionId', args.stripeSubscriptionId)
			)
			.unique();
	}
});

export const recordSubscriptionStatus = internalMutation({
	args: {
		stripeSubscriptionId: v.string(),
		status: v.union(
			v.literal('incomplete'),
			v.literal('active'),
			v.literal('past_due'),
			v.literal('paused'),
			v.literal('canceled')
		),
		currentPeriodEnd: v.optional(v.number()),
		cancelAtPeriodEnd: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const gift = await ctx.db
			.query('recurringGifts')
			.withIndex('by_stripeSubscriptionId', (q) =>
				q.eq('stripeSubscriptionId', args.stripeSubscriptionId)
			)
			.unique();
		if (!gift) return null;

		await ctx.db.patch('recurringGifts', gift._id, {
			status: args.status,
			currentPeriodEnd: args.currentPeriodEnd ?? gift.currentPeriodEnd,
			cancelAtPeriodEnd: args.cancelAtPeriodEnd ?? gift.cancelAtPeriodEnd
		});
		return null;
	}
});

/**
 * One monthly installment, recorded as its own gift.
 *
 * Keyed on the INVOICE id rather than the payment intent, because that is what
 * makes a redelivered `invoice.paid` idempotent — and because the same
 * subscription produces a new payment intent every month, so the subscription
 * id identifies the pledge, not the payment.
 *
 * This is also why `payment_intent.succeeded` is skipped when the intent
 * carries an invoice: both events fire for a subscription charge, and handling
 * both would record every recurring gift twice.
 */
export const recordInvoicePaid = internalMutation({
	args: {
		stripeInvoiceId: v.string(),
		stripeSubscriptionId: v.string(),
		stripePaymentIntentId: v.optional(v.string()),
		amountPaidCents: v.number()
	},
	handler: async (ctx, args): Promise<{ handled: boolean }> => {
		const existing = await ctx.db
			.query('donationIntents')
			.withIndex('by_stripeInvoiceId', (q) => q.eq('stripeInvoiceId', args.stripeInvoiceId))
			.unique();
		if (existing) {
			// Redelivery, or the installment we already wrote. Make sure it
			// reached the ledger, then stop.
			if (existing.status !== 'succeeded') {
				await writeGiftToLedger(ctx, existing);
				await ctx.scheduler.runAfter(0, internal.stripe.receipts.sendAcknowledgment, {
					donationIntentId: existing._id
				});
			}
			return { handled: true };
		}

		const pledge = await ctx.db
			.query('recurringGifts')
			.withIndex('by_stripeSubscriptionId', (q) =>
				q.eq('stripeSubscriptionId', args.stripeSubscriptionId)
			)
			.unique();
		if (!pledge) return { handled: false };

		const donationIntentId = await ctx.db.insert('donationIntents', {
			orgId: pledge.orgId,
			campaignId: pledge.campaignId,
			projectId: pledge.projectId,
			status: 'pending',
			// The invoice is what the donor was actually charged this month, which
			// can differ from the pledge amount if it was changed mid-cycle.
			intendedCents: args.amountPaidCents,
			chargedCents: args.amountPaidCents,
			coverFees: pledge.coverFees,
			stripeAccountId: pledge.stripeAccountId,
			stripePaymentIntentId: args.stripePaymentIntentId,
			stripeInvoiceId: args.stripeInvoiceId,
			recurringGiftId: pledge._id,
			contactId: pledge.contactId,
			donorName: pledge.donorName,
			donorEmail: pledge.donorEmail,
			anonymous: pledge.anonymous,
			designation: pledge.designation
		});

		const intent = await ctx.db.get('donationIntents', donationIntentId);
		if (!intent) throw new ConvexError('Donation intent vanished mid-mutation');

		await writeGiftToLedger(ctx, intent);
		await ctx.scheduler.runAfter(0, internal.stripe.receipts.sendAcknowledgment, {
			donationIntentId
		});

		return { handled: true };
	}
});
