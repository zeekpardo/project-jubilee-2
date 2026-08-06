/**
 * Deep links into the ORGANIZATION's own Stripe dashboard.
 *
 * This platform uses direct charges against Standard connected accounts, so
 * every payment and payout belongs to the nonprofit and appears in the
 * dashboard they log into themselves. That is why these are plain
 * `dashboard.stripe.com/...` URLs and not the platform-scoped
 * `/connect/accounts/{acct_...}/...` form: the platform view is ours to see,
 * not theirs, and sending a finance director there gets them a 404 at best.
 *
 * `livemode` is a parameter rather than something read from the environment
 * here. The mode that decides the URL is the mode of the ACCOUNT that owns the
 * record, which the caller learns from `getConnectAccount`. Reading an env var
 * in this file would make these functions untestable and would quietly produce
 * a live URL for a sandbox record on any deployment whose env disagreed with
 * the row in front of the user.
 */

const DASHBOARD = 'https://dashboard.stripe.com';

/**
 * Test-mode records live under a `/test` prefix. Getting this wrong is not a
 * cosmetic error — the id simply does not exist in the other mode, so the user
 * lands on Stripe's "no such payment" page and concludes the money is gone.
 */
function dashboardRoot(livemode: boolean): string {
	return livemode ? DASHBOARD : `${DASHBOARD}/test`;
}

/** A single payment (PaymentIntent), i.e. one donation. */
export function stripePaymentUrl(paymentIntentId: string, livemode: boolean): string {
	return `${dashboardRoot(livemode)}/payments/${encodeURIComponent(paymentIntentId)}`;
}

/** A single payout, i.e. one transfer from the Stripe balance to the bank. */
export function stripePayoutUrl(payoutId: string, livemode: boolean): string {
	return `${dashboardRoot(livemode)}/payouts/${encodeURIComponent(payoutId)}`;
}
