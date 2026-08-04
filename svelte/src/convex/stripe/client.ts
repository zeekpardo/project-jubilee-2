import Stripe from 'stripe';
import { stripeSecretKey } from './env';

/**
 * The platform's Stripe client, for the default Convex runtime.
 *
 * No `"use node"` anywhere in this directory, and that is deliberate rather
 * than incidental. `stripe@22` ships `worker`/`workerd` export conditions
 * whose entrypoint initializes `WebPlatformFunctions` — fetch for transport,
 * SubtleCrypto for signatures — both of which the default Convex runtime
 * provides. Reaching for `"use node"` would force every webhook into an
 * action-to-action runtime hop, and `http.ts` could not follow it there:
 * HTTP actions run in the same runtime as queries and mutations, always.
 *
 * The one rule that keeps this true: verify webhook signatures with
 * `stripe.webhooks.constructEventAsync(...)`, never the synchronous
 * `constructEvent`, which reaches for Node's `crypto` and will throw here.
 *
 * There is one key and one client for the whole platform. Acting as a
 * connected account is a per-call concern — pass `{ stripeAccount }` in the
 * request options, which is the SECOND argument to every SDK method, not a
 * field in the params object. A connected account has no key of its own.
 */
export function stripeClient(): Stripe {
	return new Stripe(stripeSecretKey(), {
		// Pinned rather than left to float. An SDK upgrade that silently moved
		// the API version could change webhook payload shapes underneath
		// handlers that are only exercised by real money.
		apiVersion: '2026-07-29.dahlia',
		// Actions run at most once and are not retried for us. Idempotency keys
		// make the retry safe; this makes it happen.
		maxNetworkRetries: 2,
		appInfo: { name: 'Jubilee' }
	});
}
