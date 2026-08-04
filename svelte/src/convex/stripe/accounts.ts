// Connect onboarding: the half that talks to Stripe.
//
// Every function here is an action, because every one makes a network call.
// They authorize by running `requireBillingOrg` (auth propagates from the
// action into the query), do their Stripe work, then hand the result to an
// internal mutation in `onboarding.ts` to commit.
//
// Actions run AT MOST ONCE and are not retried for us. That is why every
// Stripe call below carries an idempotency key derived from something stable —
// so a client that retries after a timeout re-reads the same object instead of
// creating a second one.

import { ConvexError, v } from 'convex/values';
import { action, internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { stripeClient } from './client';
import { donationDomains, isLivemode } from './env';
import { assertAllowedOrigin } from '../url';
import { acceptsOnlineGifts, toAccountFields, toStatementDescriptor } from '../model/stripe';

/**
 * Where an org lands when it comes back from Stripe.
 *
 * The origin is supplied by the caller and then validated against the Better
 * Auth host allowlist, which is the same control that guards every other
 * redirect in this app. It has to come from the caller because one deployment
 * serves several hosts; it has to be validated because an unchecked origin
 * here is an open redirect with a Stripe-branded referrer, which is a
 * genuinely good phishing primitive.
 */
function onboardingUrls(origin: string): { refreshUrl: string; returnUrl: string } {
	const safeOrigin = assertAllowedOrigin(origin);
	return {
		refreshUrl: `${safeOrigin}/app/admin/giving/refresh`,
		returnUrl: `${safeOrigin}/app/admin/giving/return`
	};
}

/**
 * Creates this org's connected account, then returns a link to finish it.
 *
 * The controller properties are the load-bearing part and several of them are
 * IMMUTABLE once set, so this is effectively a one-shot decision per org:
 *
 *   fees.payer = 'account'      the ORG pays Stripe, at the ORG's rate. This
 *                               is what makes the nonprofit discount reachable
 *                               at all, and it makes Stripe the 1099-K filer
 *                               rather than us.
 *   losses.payments = 'stripe'  disputes debit the org, not the platform. We
 *                               never become an unsecured creditor of our own
 *                               nonprofits.
 *   stripe_dashboard = 'full'   the org gets its own Stripe login and its own
 *                               relationship with Stripe. IMMUTABLE. Changing
 *                               course later means re-onboarding every org.
 *
 * `business_type: 'non_profit'` routes KYC to EIN plus determination letter,
 * with a representative and directors — rather than to the 25%-beneficial-owner
 * questions, which a 501(c)(3) has no answer to and which stall onboarding.
 *
 * Both capabilities are requested together deliberately: request `card_payments`
 * without `transfers` and NEITHER activates.
 */
export const createConnectedAccount = action({
	args: { origin: v.string() },
	handler: async (ctx, args): Promise<{ stripeAccountId: string; url: string }> => {
		const context = await ctx.runQuery(internal.stripe.onboarding.getAccountCreationContext, {});
		const livemode = isLivemode();

		// Cheap pre-check so the common double-click does not reach Stripe at
		// all. `insertAccount` re-checks inside a transaction, which is the one
		// that actually holds — this only saves an orphaned Stripe account.
		const existing = await ctx.runQuery(internal.stripe.onboarding.getAccountForOrg, {
			orgId: context.orgId,
			livemode
		});
		if (existing) {
			throw new ConvexError('This organization already has a Stripe account connected');
		}

		const stripe = stripeClient();
		const displayName = context.legalName ?? context.publicName;
		const { refreshUrl, returnUrl } = onboardingUrls(args.origin);

		const account = await stripe.accounts.create(
			{
				country: 'US',
				email: context.email,
				business_type: 'non_profit',
				controller: {
					fees: { payer: 'account' },
					losses: { payments: 'stripe' },
					stripe_dashboard: { type: 'full' },
					requirement_collection: 'stripe'
				},
				capabilities: {
					card_payments: { requested: true },
					transfers: { requested: true }
				},
				business_profile: {
					// Charitable and Social Service Organizations. Only meaningful
					// because the connected account is the merchant of record, and
					// what makes Visa/Mastercard charity interchange reachable.
					mcc: '8398',
					name: displayName,
					url: context.slug ? `${assertAllowedOrigin(args.origin)}/${context.slug}` : undefined,
					product_description: 'Charitable donations'
				},
				settings: {
					payments: { statement_descriptor: toStatementDescriptor(displayName) }
				},
				// A convenience for whoever is reading the Stripe dashboard during
				// an incident. Never read back as an authorization input — the
				// org is always resolved from the account id against our own table.
				metadata: { jubilee_org_id: context.orgId }
			},
			{ idempotencyKey: `acct:create:${context.orgId}:${livemode ? 'live' : 'test'}` }
		);

		await ctx.runMutation(internal.stripe.onboarding.insertAccount, {
			orgId: context.orgId,
			stripeAccountId: account.id,
			livemode,
			fields: toAccountFields(account),
			eventCreatedAt: Date.now()
		});

		const link = await stripe.accountLinks.create({
			account: account.id,
			type: 'account_onboarding',
			refresh_url: refreshUrl,
			return_url: returnUrl,
			collection_options: { fields: 'eventually_due', future_requirements: 'omit' }
		});

		return { stripeAccountId: account.id, url: link.url };
	}
});

/**
 * A fresh onboarding link for an account that already exists.
 *
 * Account Links expire after 5 minutes and are single-use, so this must be
 * called from the handler that immediately redirects. Never store one, never
 * email one, never render one into a page that might sit open.
 *
 * Serves both the "continue setup" button and the `refresh_url` Stripe sends
 * the org back to when a link expired mid-flow.
 */
export const createOnboardingLink = action({
	args: { origin: v.string() },
	handler: async (ctx, args): Promise<{ url: string }> => {
		const { orgId } = await ctx.runQuery(internal.stripe.onboarding.requireBillingOrg, {});
		const livemode = isLivemode();

		const account = await ctx.runQuery(internal.stripe.onboarding.getAccountForOrg, {
			orgId,
			livemode
		});
		if (!account) {
			throw new ConvexError('This organization has no Stripe account to set up yet');
		}

		const { refreshUrl, returnUrl } = onboardingUrls(args.origin);
		const stripe = stripeClient();

		// `account_update` once they are through the door: `account_onboarding`
		// on a completed account walks them through a form they already filled
		// in, which reads as though their work was lost.
		const type = account.detailsSubmitted ? 'account_update' : 'account_onboarding';

		const link = await stripe.accountLinks.create({
			account: account.stripeAccountId,
			type,
			refresh_url: refreshUrl,
			return_url: returnUrl,
			collection_options: { fields: 'eventually_due', future_requirements: 'omit' }
		});

		return { url: link.url };
	}
});

/**
 * Re-reads an account from Stripe and applies what it says.
 *
 * Called when the org returns from onboarding, and available as a manual
 * "check again" in admin. Both matter because `return_url` means only "the
 * user came back" — it is not a completion signal, and an org that abandoned
 * the flow halfway hits exactly the same URL as one that finished.
 *
 * Retrieving is authoritative in a way the webhook payload is not: it cannot
 * be stale and it cannot arrive out of order.
 */
export const refreshAccountStatus = action({
	args: {},
	handler: async (ctx): Promise<{ status: string } | null> => {
		const { orgId } = await ctx.runQuery(internal.stripe.onboarding.requireBillingOrg, {});
		const livemode = isLivemode();

		const account = await ctx.runQuery(internal.stripe.onboarding.getAccountForOrg, {
			orgId,
			livemode
		});
		if (!account) return null;

		return await ctx.runAction(internal.stripe.accounts.syncAccount, {
			stripeAccountId: account.stripeAccountId
		});
	}
});

/**
 * The unauthenticated half of the refresh, so webhooks and crons can use it.
 *
 * Split out rather than duplicated because this is also what runs after
 * `account.updated`: rather than trusting a payload that may have overtaken a
 * newer one, we re-fetch and apply the authoritative state.
 */
export const syncAccount = internalAction({
	args: { stripeAccountId: v.string() },
	handler: async (ctx, args): Promise<{ status: string }> => {
		const stripe = stripeClient();
		const account = await stripe.accounts.retrieve(args.stripeAccountId);
		const fields = toAccountFields(account);

		await ctx.runMutation(internal.stripe.onboarding.applyAccountFields, {
			stripeAccountId: args.stripeAccountId,
			fields,
			eventCreatedAt: Date.now()
		});

		// Wallets are worth registering the moment they can work, and this is
		// the one place that reliably learns an account just started accepting
		// charges. Scheduled rather than awaited: a registration failure must
		// not fail the status sync that told us the org is finally live.
		if (acceptsOnlineGifts(fields.status)) {
			await ctx.scheduler.runAfter(0, internal.stripe.accounts.registerWalletDomains, {
				stripeAccountId: args.stripeAccountId
			});
		}

		return { status: fields.status };
	}
});

/**
 * Registers every donation domain on one connected account.
 *
 * This is not optional and it is not something the Dashboard can do on an
 * org's behalf: with direct charges, a platform registering its own domain
 * does NOT cover its connected accounts. Every donation domain must be
 * registered on every account, over the API.
 *
 * The failure mode is what makes it worth the trouble — an unregistered domain
 * does not error at checkout, it simply makes the Apple Pay / Google Pay / Link
 * buttons not render. Nobody notices except as unexplained conversion loss, so
 * the outcome is written back to the row and surfaced in admin.
 *
 * Registering in LIVE mode also covers sandboxes; the reverse is not true.
 * There are no wildcards, and every subdomain is a separate registration.
 */
export const registerWalletDomains = internalAction({
	args: { stripeAccountId: v.string() },
	handler: async (ctx, args): Promise<{ registered: string[] }> => {
		const domains = donationDomains();
		if (domains.length === 0) return { registered: [] };

		const stripe = stripeClient();
		const registered: string[] = [];

		for (const domain of domains) {
			try {
				await stripe.paymentMethodDomains.create(
					{ domain_name: domain },
					{
						stripeAccount: args.stripeAccountId,
						idempotencyKey: `pmd:${args.stripeAccountId}:${domain}`
					}
				);
				registered.push(domain);
			} catch (error) {
				// One bad domain must not cost the others their registration, and
				// re-running this is safe, so a failure is recorded by omission
				// rather than by throwing.
				console.error(
					`Wallet domain registration failed for ${domain} on ${args.stripeAccountId}`,
					error
				);
			}
		}

		await ctx.runMutation(internal.stripe.onboarding.setWalletDomains, {
			stripeAccountId: args.stripeAccountId,
			domains: registered
		});

		return { registered };
	}
});

/**
 * Updates the processing rate we quote to fee-covering donors.
 *
 * Manual because Stripe exposes no way to read an account's negotiated rate.
 * When an org is granted the nonprofit discount, somebody has to say so — and
 * until they do, every fee-covering donor of that org is quoted the standard
 * rate and the org keeps the difference.
 */
export const setFeeConfig = action({
	args: { feeRate: v.number(), feeFixedCents: v.number() },
	handler: async (ctx, args): Promise<null> => {
		const { orgId } = await ctx.runQuery(internal.stripe.onboarding.requireBillingOrg, {});
		await ctx.runMutation(internal.stripe.onboarding.updateFeeConfig, {
			orgId,
			livemode: isLivemode(),
			feeRate: args.feeRate,
			feeFixedCents: args.feeFixedCents
		});
		return null;
	}
});
