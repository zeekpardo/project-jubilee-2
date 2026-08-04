import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

/**
 * Scheduled work.
 *
 * `crons.interval` and `crons.cron` only — the `daily`/`hourly` helpers are
 * disallowed by the project guidelines.
 */
const crons = cronJobs();

// Retries webhook deliveries whose handler failed. Stripe gives up retrying
// after roughly three days and then disables the endpoint, so a run of
// failures during an outage would otherwise become permanently lost donations
// with a 200 already returned.
crons.interval(
	'retry failed stripe events',
	{ minutes: 15 },
	internal.stripe.reconcile.retryFailedEvents,
	{}
);

// Re-reads connected accounts from Stripe. `account.updated` is the fast path
// and this is the safety net: a delivery dropped during an outage would
// otherwise leave an org's donation form switched off — or, worse, switched on
// after Stripe restricted them.
crons.interval(
	'resync stripe accounts',
	{ hours: 6 },
	internal.stripe.reconcile.resyncAccounts,
	{}
);

// Finds gifts that Stripe believes succeeded but that never reached our
// ledger. This is the one that catches the case nothing else can: a webhook
// that was never delivered at all.
crons.interval(
	'reconcile stripe donations',
	{ hours: 1 },
	internal.stripe.reconcile.reconcilePendingGifts,
	{}
);

// Retires intents from donors who opened the form and never entered a card.
// They are not money and never were, so left alone they are just noise that
// grows — in every admin count of gifts, and in the sweep above.
crons.interval(
	'expire abandoned donation intents',
	{ hours: 24 },
	internal.stripe.reconcile.expireAbandonedGifts,
	{}
);

export default crons;
