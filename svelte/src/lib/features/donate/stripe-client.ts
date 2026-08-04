import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { env } from '$env/dynamic/public';

/**
 * Stripe.js, scoped to the connected account a gift is being charged on.
 *
 * This is the rule that trips up every direct-charge integration: the browser
 * must initialize Stripe.js with the SAME connected account the PaymentIntent
 * was created on, or confirmation fails with an unhelpful error about the
 * client secret not being found.
 *
 * We pass OUR platform publishable key with a `stripeAccount` option. There is
 * no such thing as fetching a connected account's publishable key, and nothing
 * here is secret — a publishable key is meant to be in the page.
 *
 * `stripeAccount` is a CONSTRUCTOR option only; it cannot be changed on an
 * existing instance. A different org therefore means a different `loadStripe`
 * call, which is why these are cached per account rather than as a singleton —
 * a donor moving between two orgs' pages in one session would otherwise be
 * confirming against the wrong account.
 *
 * Read from `$env/dynamic/public` rather than `$env/static/public` so a
 * deployment without the key still builds and serves every page that is not a
 * donation form. A static import would turn a missing key into a build
 * failure for the whole site.
 */
const cache = new Map<string, Promise<Stripe | null>>();

export function stripeForAccount(stripeAccount: string): Promise<Stripe | null> {
	let instance = cache.get(stripeAccount);
	if (!instance) {
		const key = env.PUBLIC_STRIPE_PUBLISHABLE_KEY;
		if (!key) {
			return Promise.resolve(null);
		}
		instance = loadStripe(key, { stripeAccount });
		cache.set(stripeAccount, instance);
	}
	return instance;
}

/** Whether a donation form can work at all in this deployment. */
export function hasPublishableKey(): boolean {
	return Boolean(env.PUBLIC_STRIPE_PUBLISHABLE_KEY);
}
