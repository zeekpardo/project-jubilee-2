/**
 * The Stripe secrets, read once and guarded at each use.
 *
 * Convex's typed-env API (`defineApp({ env: {...} })` plus `env` from
 * `_generated/server`) is what the project guidelines ask for, and it is what
 * PLAN-stripe.md §13 specifies. It does not exist on the Convex version this
 * repo is pinned to — 1.36.1's `defineApp` accepts `{ httpPrefix }` and
 * nothing else; the typed form landed in 1.41. So this follows the convention
 * already in `email.ts` instead: read at module scope, throw at the point of
 * use rather than at import, so a missing secret fails the one action that
 * needed it instead of taking down every function in the deployment.
 *
 * Switch this file to typed env when Convex is upgraded. Nothing outside it
 * touches `process.env`, so that is a one-file change.
 *
 * All of these live in Convex deployment env only (`npx convex env set`), and
 * none of them belong in the repo. The publishable key is the exception and is
 * not here: it is safe to expose, so it rides in SvelteKit's public env as
 * `PUBLIC_STRIPE_PUBLISHABLE_KEY`.
 */

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_CONNECT_WEBHOOK_SECRET = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
const STRIPE_PLATFORM_WEBHOOK_SECRET = process.env.STRIPE_PLATFORM_WEBHOOK_SECRET;
const STRIPE_DONATION_DOMAINS = process.env.STRIPE_DONATION_DOMAINS;

function required(name: string, value: string | undefined): string {
	if (!value) {
		throw new Error(`${name} environment variable is required but not set`);
	}
	return value;
}

/**
 * The platform's own secret key. Every call that acts on a connected account
 * uses this key and passes `{ stripeAccount }` in the request options — there
 * is no such thing as holding a connected account's key.
 */
export function stripeSecretKey(): string {
	return required('STRIPE_SECRET_KEY', STRIPE_SECRET_KEY);
}

/**
 * Which Stripe world this deployment lives in, read off the key prefix rather
 * than carried as a second env var that could disagree with it.
 *
 * Test and live `acct_` ids are different objects, so this is what keeps a
 * sandbox account and a real one from overwriting each other in
 * `stripeAccounts` — and what a webhook handler checks `event.livemode`
 * against before touching anything.
 *
 * Does not throw when the key is unset: an unconfigured deployment has no
 * accounts in either mode, and the admin surface should render "not connected"
 * rather than an error.
 */
export function isLivemode(): boolean {
	return STRIPE_SECRET_KEY?.startsWith('sk_live_') ?? false;
}

/**
 * Signing secret for the Connect endpoint, which carries essentially all
 * donation traffic under direct charges.
 *
 * Deliberately separate from the platform secret below, and never
 * interchangeable: sharing one secret across both endpoints would let an event
 * about our own account be accepted as an event about an org's.
 */
export function connectWebhookSecret(): string {
	return required('STRIPE_CONNECT_WEBHOOK_SECRET', STRIPE_CONNECT_WEBHOOK_SECRET);
}

/** Signing secret for the platform endpoint — our own account's events. */
export function platformWebhookSecret(): string {
	return required('STRIPE_PLATFORM_WEBHOOK_SECRET', STRIPE_PLATFORM_WEBHOOK_SECRET);
}

/**
 * Domains that serve the donation form, for per-account wallet registration.
 *
 * Returns empty rather than throwing: an org can onboard and take card gifts
 * without this set. What it loses is Apple Pay, Google Pay and Link, silently
 * — which is why the admin surface reports what actually registered instead of
 * assuming this succeeded.
 */
export function donationDomains(): string[] {
	return (STRIPE_DONATION_DOMAINS ?? '')
		.split(',')
		.map((d) => d.trim())
		.filter(Boolean);
}
