// Treating Stripe as the source of truth, on a timer.
//
// Every path in this app that records money is webhook-driven, and webhooks
// are a best-effort delivery mechanism over someone else's network. That is
// fine — as long as something eventually notices what did not arrive. This
// file is that something.
//
// The three sweeps answer three different failures:
//
//   retryFailedEvents      we received it and our handler threw
//   resyncAccounts         we never received an `account.updated` at all
//   reconcilePendingGifts  we never received the payment event at all
//
// The last is the one that matters most: a donor is charged, believes they
// have given, and the nonprofit has no record. Nothing else in the system
// catches that.

import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { stripeClient } from './client';
import { isLivemode } from './env';

/** Bounded so one sweep cannot exceed a transaction's limits. */
const BATCH = 50;

// ------------------------------------------------------------
// Failed deliveries
// ------------------------------------------------------------

export const listFailedEvents = internalQuery({
	args: {},
	handler: async (ctx): Promise<Doc<'stripeEvents'>[]> => {
		// Rows with an error and no `handledAt`. Scanned newest-first over a
		// bounded window rather than filtered across the whole table, which
		// would grow without limit as event volume does.
		const recent = await ctx.db.query('stripeEvents').order('desc').take(500);
		return recent.filter((event) => event.handledAt === undefined && event.error !== undefined);
	}
});

/**
 * Re-runs handlers for deliveries that failed.
 *
 * Deliberately does NOT re-verify a signature: the event was verified when it
 * arrived, and the raw body is long gone. What it replays is the effect, by
 * re-reading the current state from Stripe — which is more correct than
 * replaying a stale payload would have been anyway.
 */
export const retryFailedEvents = internalAction({
	args: {},
	handler: async (ctx): Promise<{ retried: number }> => {
		const failed = await ctx.runQuery(internal.stripe.reconcile.listFailedEvents, {});
		let retried = 0;

		for (const event of failed.slice(0, BATCH)) {
			try {
				if (event.type.startsWith('account.') || event.type.startsWith('capability.')) {
					if (!event.stripeAccountId) continue;
					await ctx.runAction(internal.stripe.accounts.syncAccount, {
						stripeAccountId: event.stripeAccountId
					});
				} else {
					// Payment-shaped failures are covered by the gift sweep below,
					// which reads Stripe directly. Marking handled here would hide
					// the row from that sweep before it had a chance to run.
					continue;
				}
				await ctx.runMutation(internal.stripe.webhooks.markEventHandled, {
					stripeEventId: event.stripeEventId
				});
				retried += 1;
			} catch (error) {
				console.error(`Retry failed for ${event.type} (${event.stripeEventId})`, error);
			}
		}

		return { retried };
	}
});

// ------------------------------------------------------------
// Account drift
// ------------------------------------------------------------

export const listAccounts = internalQuery({
	args: { livemode: v.boolean() },
	handler: async (ctx, args): Promise<Doc<'stripeAccounts'>[]> => {
		const accounts = await ctx.db.query('stripeAccounts').take(500);
		return accounts.filter((account) => account.livemode === args.livemode);
	}
});

/**
 * Re-reads every connected account.
 *
 * Cheap enough at this scale to do unconditionally rather than trying to guess
 * which accounts might be stale. When it stops being cheap, the fix is to
 * order by `lastSyncedAt` and take the oldest slice — not to skip accounts
 * that look settled, because "looks settled" is exactly what a missed
 * restriction event produces.
 */
export const resyncAccounts = internalAction({
	args: {},
	handler: async (ctx): Promise<{ synced: number }> => {
		const accounts = await ctx.runQuery(internal.stripe.reconcile.listAccounts, {
			livemode: isLivemode()
		});
		let synced = 0;

		for (const account of accounts.slice(0, BATCH)) {
			try {
				await ctx.runAction(internal.stripe.accounts.syncAccount, {
					stripeAccountId: account.stripeAccountId
				});
				synced += 1;
			} catch (error) {
				console.error(`Could not resync ${account.stripeAccountId}`, error);
			}
		}

		return { synced };
	}
});

// ------------------------------------------------------------
// Gifts Stripe took but we never recorded
// ------------------------------------------------------------

export const listUnsettledGifts = internalQuery({
	args: {},
	handler: async (ctx): Promise<Doc<'donationIntents'>[]> => {
		// Newest-first over a bounded window. Scanning by status across every
		// org would need a status-only index, and the volume that would justify
		// one is the volume at which this whole sweep needs rethinking anyway.
		const pending = await ctx.db.query('donationIntents').order('desc').take(500);

		const cutoff = Date.now() - 10 * 60 * 1000;
		return pending.filter(
			(intent) =>
				(intent.status === 'pending' || intent.status === 'processing') &&
				intent.stripePaymentIntentId !== undefined &&
				// Young intents are almost all donors still typing a card number.
				// Only chase ones old enough that a webhook really should have
				// arrived by now.
				intent._creationTime < cutoff
		);
	}
});

/**
 * Asks Stripe what actually happened to every gift still sitting unsettled.
 *
 * This is the sweep that catches a donation the org would otherwise never
 * learn about. It reads the PaymentIntent as the connected account — a
 * platform-credentialed read of a connected account's intent 404s — and drives
 * the same internal mutations the webhook would have.
 *
 * Idempotent throughout: every mutation it calls is safe to run again, so a
 * sweep racing a late webhook cannot double-record a gift.
 */
export const reconcilePendingGifts = internalAction({
	args: {},
	handler: async (ctx): Promise<{ settled: number; failed: number }> => {
		const unsettled = await ctx.runQuery(internal.stripe.reconcile.listUnsettledGifts, {});
		const stripe = stripeClient();
		let settled = 0;
		let failed = 0;

		for (const intent of unsettled.slice(0, BATCH)) {
			if (!intent.stripePaymentIntentId) continue;
			try {
				// Empty params so the request options land in the third slot —
				// a two-argument call would read them as params and drop the
				// `Stripe-Account` header, and a platform-credentialed read of a
				// connected account's PaymentIntent 404s.
				const paymentIntent = await stripe.paymentIntents.retrieve(
					intent.stripePaymentIntentId,
					{},
					{ stripeAccount: intent.stripeAccountId }
				);

				switch (paymentIntent.status) {
					case 'succeeded':
						await ctx.runMutation(internal.stripe.webhooks.recordGiftSucceeded, {
							stripePaymentIntentId: paymentIntent.id
						});
						settled += 1;
						break;
					case 'processing':
						await ctx.runMutation(internal.stripe.webhooks.recordGiftProcessing, {
							stripePaymentIntentId: paymentIntent.id
						});
						break;
					case 'canceled':
						await ctx.runMutation(internal.stripe.webhooks.recordGiftFailed, {
							stripePaymentIntentId: paymentIntent.id,
							failureMessage: 'Canceled at Stripe'
						});
						failed += 1;
						break;
					default:
						// requires_payment_method and friends: the donor opened the
						// form and walked away. Left pending rather than marked
						// failed, because they may still come back to the tab.
						break;
				}
			} catch (error) {
				console.error(`Could not reconcile ${intent.stripePaymentIntentId}`, error);
			}
		}

		return { settled, failed };
	}
});

/**
 * Clears out abandoned intents so the sweep above stays bounded.
 *
 * A donor who opened the form and never entered a card leaves a `pending` row
 * forever. They are not money and never were, so after a week they are noise
 * in every admin view that counts gifts.
 */
export const expireAbandonedGifts = internalMutation({
	args: {},
	handler: async (ctx): Promise<{ expired: number }> => {
		const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
		const stale = await ctx.db.query('donationIntents').order('asc').take(200);

		let expired = 0;
		for (const intent of stale) {
			if (intent.status !== 'pending') continue;
			if (intent._creationTime >= cutoff) break;
			await ctx.db.patch('donationIntents', intent._id, {
				status: 'failed',
				failureMessage: 'Abandoned before payment'
			});
			expired += 1;
		}
		return { expired };
	}
});
