// Verifying, narrowing and routing Stripe webhook deliveries.
//
// Kept out of `http.ts` so that file stays a routing table. These are plain
// functions rather than Convex functions: they run inside the HTTP action's
// own context, which is an action context, so they may both call Stripe and
// run mutations.
//
// Two endpoints and two signing secrets, never shared. With direct charges
// essentially all donation traffic arrives on the CONNECT endpoint, and
// `event.account` is what distinguishes them. Sharing one secret would let an
// event about our own platform account be accepted as an event about an org's.

import type Stripe from 'stripe';
import type { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { stripeClient } from './client';
import { connectWebhookSecret, isLivemode, platformWebhookSecret } from './env';

/**
 * A fresh 200 per call.
 *
 * Deliberately a function rather than a shared constant: a `Response` is a
 * one-shot object, and handing the same instance to two concurrent deliveries
 * is the kind of bug that only shows up under the load a real giving day
 * produces. Stripe's retry window is about three days, after which it disables
 * the endpoint — so a response we cannot return cleanly is expensive.
 */
function ok(): Response {
	return new Response(null, { status: 200 });
}

/**
 * Verifies a delivery and hands it to the dispatcher.
 *
 * Three things here are non-negotiable:
 *
 *   The RAW body. The signature is HMAC-SHA256 over `${timestamp}.${rawBody}`,
 *   so any parse-and-reserialize breaks it. `req.text()` first, always.
 *
 *   `constructEventAsync`, never `constructEvent`. The synchronous one reaches
 *   for Node's `crypto`, which does not exist in the Convex runtime that HTTP
 *   actions are required to run in.
 *
 *   A fast 200. Stripe times out in seconds and retries; slow handlers turn
 *   one gift into several delivery attempts.
 */
export async function handleStripeWebhook(
	ctx: ActionCtx,
	req: Request,
	endpoint: 'connect' | 'platform'
): Promise<Response> {
	const signature = req.headers.get('stripe-signature');
	if (!signature) return new Response('Missing stripe-signature', { status: 400 });

	const body = await req.text();
	const secret = endpoint === 'connect' ? connectWebhookSecret() : platformWebhookSecret();

	let event: Stripe.Event;
	try {
		event = await stripeClient().webhooks.constructEventAsync(body, signature, secret);
	} catch (error) {
		// Deliberately terse. A verification failure is either misconfiguration
		// or someone probing the endpoint, and neither deserves a detailed reply.
		console.error('Stripe signature verification failed', error);
		return new Response('Signature verification failed', { status: 400 });
	}

	// A live event arriving at a test deployment (or the reverse) means the
	// endpoint is wired to the wrong place. Acknowledged rather than retried,
	// because retrying will not fix a configuration mistake — but never acted
	// on, because test and live `acct_` ids are different objects and applying
	// one to the other would corrupt real state.
	if (event.livemode !== isLivemode()) {
		console.error(
			`Ignoring ${event.type} (${event.id}): livemode ${event.livemode} does not match this deployment`
		);
		return ok();
	}

	const claim = await ctx.runMutation(internal.stripe.webhooks.recordEvent, {
		stripeEventId: event.id,
		type: event.type,
		stripeAccountId: event.account,
		livemode: event.livemode,
		createdAt: event.created
	});
	if (!claim.shouldHandle) return ok();

	try {
		await dispatch(ctx, event);
		await ctx.runMutation(internal.stripe.webhooks.markEventHandled, {
			stripeEventId: event.id
		});
		return ok();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await ctx.runMutation(internal.stripe.webhooks.markEventFailed, {
			stripeEventId: event.id,
			error: message
		});
		// A 500 asks Stripe to retry, which is what we want for a transient
		// failure. `handledAt` was left unset, so the retry re-runs the handler
		// rather than being deduped away as already done.
		console.error(`Stripe handler failed for ${event.type} (${event.id})`, error);
		return new Response('Handler failed', { status: 500 });
	}
}

/** `x` when Stripe expanded it, its id when it did not, undefined when absent. */
function idOf(value: string | { id: string } | null | undefined): string | undefined {
	if (!value) return undefined;
	return typeof value === 'string' ? value : value.id;
}

async function dispatch(ctx: ActionCtx, event: Stripe.Event): Promise<void> {
	switch (event.type) {
		// ----------------------------------------------------------
		// Account lifecycle
		// ----------------------------------------------------------
		case 'account.updated':
		case 'capability.updated': {
			// Re-fetch rather than apply the payload. `account.updated` is chatty
			// and unordered, and a stale payload applied last would roll an org
			// backwards — switching off a working donation form and emailing them
			// that Stripe needs documents it already has.
			const accountId = event.account ?? idOf(event.data.object as unknown as { id: string });
			if (!accountId) return;
			await ctx.runAction(internal.stripe.accounts.syncAccount, {
				stripeAccountId: accountId
			});
			return;
		}

		case 'account.application.deauthorized': {
			if (!event.account) return;
			await ctx.runMutation(internal.stripe.webhooks.recordDeauthorized, {
				stripeAccountId: event.account
			});
			return;
		}

		// ----------------------------------------------------------
		// One-time gifts
		// ----------------------------------------------------------
		case 'payment_intent.succeeded': {
			const intent = event.data.object;
			// A subscription installment fires BOTH this and `invoice.paid`.
			// Handling both would record every recurring gift twice, so the
			// invoice — which is the idempotent key for a monthly charge — wins.
			if (getInvoiceId(intent)) return;
			await ctx.runMutation(internal.stripe.webhooks.recordGiftSucceeded, {
				stripePaymentIntentId: intent.id
			});
			return;
		}

		case 'payment_intent.processing': {
			await ctx.runMutation(internal.stripe.webhooks.recordGiftProcessing, {
				stripePaymentIntentId: event.data.object.id
			});
			return;
		}

		case 'payment_intent.payment_failed': {
			const intent = event.data.object;
			await ctx.runMutation(internal.stripe.webhooks.recordGiftFailed, {
				stripePaymentIntentId: intent.id,
				failureMessage: intent.last_payment_error?.message
			});
			return;
		}

		// ----------------------------------------------------------
		// Fees, which only exist once a balance transaction does
		// ----------------------------------------------------------
		case 'charge.succeeded':
		case 'charge.updated': {
			await recordChargeFees(ctx, event.data.object, event.account);
			return;
		}

		case 'charge.refunded': {
			const charge = event.data.object;
			const paymentIntentId = idOf(charge.payment_intent);
			if (!paymentIntentId) return;
			await ctx.runMutation(internal.stripe.webhooks.recordGiftReversed, {
				stripePaymentIntentId: paymentIntentId,
				status: 'refunded',
				// Cumulative, not the size of this one refund. This event fires
				// for a partial refund exactly as it does for a full one, and
				// treating it as "the gift is gone" would erase money the
				// nonprofit still holds.
				refundedCents: charge.amount_refunded
			});
			return;
		}

		case 'charge.dispute.created':
		case 'charge.dispute.updated':
		case 'charge.dispute.closed': {
			const dispute = event.data.object;
			if (!event.account) return;

			const chargeId = idOf(dispute.charge);
			if (!chargeId) return;
			const paymentIntentId = idOf(dispute.payment_intent);

			await ctx.runMutation(internal.stripe.webhooks.recordDispute, {
				stripeAccountId: event.account,
				stripeDisputeId: dispute.id,
				stripeChargeId: chargeId,
				stripePaymentIntentId: paymentIntentId,
				amountCents: dispute.amount,
				currency: dispute.currency,
				reason: dispute.reason,
				status: dispute.status,
				evidenceDueBy: dispute.evidence_details?.due_by
					? dispute.evidence_details.due_by * 1000
					: undefined,
				createdAt: dispute.created * 1000
			});

			if (!paymentIntentId) return;

			// The funds are held from the moment a dispute opens, so the gift
			// comes out of the ledger then rather than when it closes. A dispute
			// the org WINS restores the money — which we deliberately do not
			// re-post automatically, because Stripe re-credits the balance
			// without a new charge and inventing a transaction to match would be
			// a fabricated ledger row. It is surfaced in admin for a human to
			// re-enter, which is the same path any other correction takes.
			if (dispute.status === 'won' || dispute.status === 'warning_closed') return;

			await ctx.runMutation(internal.stripe.webhooks.recordGiftReversed, {
				stripePaymentIntentId: paymentIntentId,
				status: 'disputed',
				// A dispute is always for the whole disputed amount; there is no
				// partial-dispute concept the way there is for refunds.
				refundedCents: dispute.amount
			});
			return;
		}

		// ----------------------------------------------------------
		// Payouts — money reaching the org's actual bank account
		// ----------------------------------------------------------
		case 'payout.created':
		case 'payout.updated':
		case 'payout.paid':
		case 'payout.failed':
		case 'payout.canceled': {
			const payout = event.data.object;
			if (!event.account) return;
			await ctx.runMutation(internal.stripe.webhooks.recordPayout, {
				stripeAccountId: event.account,
				stripePayoutId: payout.id,
				amountCents: payout.amount,
				currency: payout.currency,
				status: mapPayoutStatus(payout.status),
				arrivalDate: payout.arrival_date ? payout.arrival_date * 1000 : undefined,
				failureCode: payout.failure_code ?? undefined,
				failureMessage: payout.failure_message ?? undefined,
				statementDescriptor: payout.statement_descriptor ?? undefined,
				createdAt: payout.created * 1000
			});
			return;
		}

		// ----------------------------------------------------------
		// Recurring
		// ----------------------------------------------------------
		case 'invoice.paid': {
			const invoice = event.data.object;
			const subscriptionId = getSubscriptionId(invoice);
			if (!subscriptionId) return;
			await ctx.runMutation(internal.stripe.webhooks.recordInvoicePaid, {
				stripeInvoiceId: invoice.id!,
				stripeSubscriptionId: subscriptionId,
				stripePaymentIntentId: getInvoicePaymentIntentId(invoice),
				amountPaidCents: invoice.amount_paid
			});
			return;
		}

		case 'customer.subscription.updated':
		case 'customer.subscription.deleted': {
			const subscription = event.data.object;
			await ctx.runMutation(internal.stripe.webhooks.recordSubscriptionStatus, {
				stripeSubscriptionId: subscription.id,
				status: mapSubscriptionStatus(subscription.status),
				currentPeriodEnd: getCurrentPeriodEnd(subscription),
				cancelAtPeriodEnd: subscription.cancel_at_period_end ?? undefined
			});
			return;
		}

		// ----------------------------------------------------------
		// Things worth seeing but not yet worth acting on
		// ----------------------------------------------------------
		case 'invoice.payment_failed':
		case 'payment_method.automatically_updated':
		case 'radar.early_fraud_warning.created':
		case 'application_fee.created':
		case 'application_fee.refunded': {
			// Recorded in `stripeEvents` by `recordEvent` above, which is enough
			// to reconstruct what happened. Acting on these needs product
			// decisions that have not been made — who gets told about a failed
			// payout, whether a won dispute restores the ledger row, what a
			// fraud warning should do to an org's account. Left explicit rather
			// than falling through so the list of known-unhandled events is
			// visible instead of implied.
			console.info(`Stripe event acknowledged without action: ${event.type} (${event.id})`);
			return;
		}

		default:
			return;
	}
}

/**
 * Attaches the real fee numbers to a gift.
 *
 * These cannot be computed in advance — the rate varies by payment method, and
 * the donor picks theirs inside the Payment Element, after our fee-cover
 * toggle. Only the balance transaction knows what actually happened.
 *
 * Requires a follow-up API call because the webhook carries only the balance
 * transaction's ID. That call MUST be authenticated as the connected account:
 * retrieving a connected account's balance transaction with plain platform
 * credentials 404s.
 */
async function recordChargeFees(
	ctx: ActionCtx,
	charge: Stripe.Charge,
	stripeAccountId: string | undefined
): Promise<void> {
	const paymentIntentId = idOf(charge.payment_intent);
	if (!paymentIntentId) return;

	let stripeFeeCents: number | undefined;
	let netCents: number | undefined;
	const applicationFeeCents = charge.application_fee_amount ?? undefined;

	const balanceTransactionId = idOf(charge.balance_transaction);
	if (balanceTransactionId && stripeAccountId) {
		try {
			// The empty params object is required, not decorative: with two
			// arguments the SDK reads the second as PARAMS, so request options
			// have to be the third. Getting this wrong silently drops the
			// `Stripe-Account` header and the call 404s against the platform.
			const balanceTransaction = await stripeClient().balanceTransactions.retrieve(
				balanceTransactionId,
				{},
				{ stripeAccount: stripeAccountId }
			);
			// On a direct charge with `fees.payer = 'account'`, the connected
			// account's balance transaction counts BOTH Stripe's processing fee
			// and our application fee in `fee`. Subtracting ours leaves Stripe's,
			// which is the number a nonprofit actually wants to see.
			stripeFeeCents = balanceTransaction.fee - (applicationFeeCents ?? 0);
			netCents = balanceTransaction.net;
		} catch (error) {
			// Fees are reporting, not money. Losing them must not fail the
			// delivery and cause Stripe to retry a charge event we already
			// handled correctly.
			console.error(`Could not read balance transaction ${balanceTransactionId}`, error);
		}
	}

	await ctx.runMutation(internal.stripe.webhooks.recordGiftFees, {
		stripePaymentIntentId: paymentIntentId,
		stripeChargeId: charge.id,
		stripeFeeCents,
		platformFeeCents: applicationFeeCents,
		netCents
	});
}

// ------------------------------------------------------------
// Shape helpers
//
// Stripe has moved several of these fields between top-level properties and
// nested containers across API versions. Reading them through one narrow
// accessor each means a version bump breaks in one place with a type error,
// rather than silently returning undefined at a call site and quietly
// dropping every recurring gift.
// ------------------------------------------------------------

function getInvoiceId(intent: Stripe.PaymentIntent): string | undefined {
	const withInvoice = intent as unknown as { invoice?: string | { id: string } | null };
	return idOf(withInvoice.invoice);
}

function getSubscriptionId(invoice: Stripe.Invoice): string | undefined {
	const withSubscription = invoice as unknown as {
		subscription?: string | { id: string } | null;
		parent?: {
			subscription_details?: { subscription?: string | { id: string } | null } | null;
		} | null;
	};
	return (
		idOf(withSubscription.subscription) ??
		idOf(withSubscription.parent?.subscription_details?.subscription)
	);
}

function getInvoicePaymentIntentId(invoice: Stripe.Invoice): string | undefined {
	const withIntent = invoice as unknown as {
		payment_intent?: string | { id: string } | null;
		payments?: {
			data?: Array<{ payment?: { payment_intent?: string | { id: string } | null } | null }>;
		} | null;
	};
	return (
		idOf(withIntent.payment_intent) ?? idOf(withIntent.payments?.data?.[0]?.payment?.payment_intent)
	);
}

function getCurrentPeriodEnd(subscription: Stripe.Subscription): number | undefined {
	const withPeriod = subscription as unknown as {
		current_period_end?: number | null;
		items?: { data?: Array<{ current_period_end?: number | null }> } | null;
	};
	const seconds = withPeriod.current_period_end ?? withPeriod.items?.data?.[0]?.current_period_end;
	// Stripe speaks seconds; everything on our side is milliseconds.
	return seconds ? seconds * 1000 : undefined;
}

/**
 * Stripe's payout statuses, which our union mirrors exactly except that an
 * unrecognized one is treated as `pending` rather than failing the delivery.
 * A payout we mislabel as in-flight is a cosmetic error; a 500 here would make
 * Stripe retry a payout event forever.
 */
function mapPayoutStatus(
	status: string
): 'pending' | 'in_transit' | 'paid' | 'canceled' | 'failed' {
	switch (status) {
		case 'in_transit':
		case 'paid':
		case 'canceled':
		case 'failed':
			return status;
		default:
			return 'pending';
	}
}

/**
 * Stripe has more subscription states than a donor-facing pledge needs.
 * `unpaid` collapses into `past_due` because both mean "the card is failing
 * and dunning is running", which is one conversation with the donor, not two.
 */
function mapSubscriptionStatus(
	status: Stripe.Subscription.Status
): 'incomplete' | 'active' | 'past_due' | 'paused' | 'canceled' {
	switch (status) {
		case 'active':
		case 'trialing':
			return 'active';
		case 'past_due':
		case 'unpaid':
			return 'past_due';
		case 'paused':
			return 'paused';
		case 'canceled':
		case 'incomplete_expired':
			return 'canceled';
		case 'incomplete':
		default:
			return 'incomplete';
	}
}
