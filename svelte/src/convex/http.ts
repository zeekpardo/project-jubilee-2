import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { authComponent, createAuth } from './auth';
import { resend } from './email';
import { handleStripeWebhook } from './stripe/events';

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

http.route({
	path: '/resend-webhook',
	method: 'POST',
	handler: httpAction(async (ctx, req) => {
		return await resend.handleResendEventWebhook(ctx, req);
	})
});

// Two Stripe endpoints, two signing secrets, deliberately never shared.
//
//   /stripe/connect-webhook   events on every connected account. Under direct
//                             charges this is where essentially all donation
//                             traffic arrives, and `event.account` is set.
//   /stripe/webhook           events on our own platform account.
//
// One platform-level Connect endpoint rather than one per account, so an org
// that onboards tomorrow is covered without any registration step.
//
// Note there is no `"use node"` here and there cannot be: HTTP actions run in
// the same runtime as queries and mutations. That is why signature
// verification uses `constructEventAsync`. See `stripe/client.ts`.
http.route({
	path: '/stripe/connect-webhook',
	method: 'POST',
	handler: httpAction(async (ctx, req) => {
		return await handleStripeWebhook(ctx, req, 'connect');
	})
});

http.route({
	path: '/stripe/webhook',
	method: 'POST',
	handler: httpAction(async (ctx, req) => {
		return await handleStripeWebhook(ctx, req, 'platform');
	})
});

export default http;
