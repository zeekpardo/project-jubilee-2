// Monthly giving: Stripe Subscriptions on the connected account.
//
// Under direct charges the Customer, the Product and the Subscription ALL live
// on the org's account, not ours. That is the source of most of the awkward
// parts here — a donor giving monthly to four orgs has four Customers and four
// saved cards, and there is no supported way to share one payment method
// across them that keeps the card up to date.
//
// The client side of this flow is byte-identical to the one-time flow: same
// Payment Element, same `confirmPayment`. Only the endpoint that mints the
// client secret differs. That is exactly why the once/monthly toggle is cheap
// with the Payment Element and would be expensive with hosted Checkout, which
// would need a Price object per org, per amount, per interval.

import { ConvexError, v } from 'convex/values';
import { action, internalMutation, internalAction, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { stripeClient } from './client';
import { isLivemode } from './env';
import { computeGiftAmounts } from '../model/stripe';

/**
 * The Product a campaign's monthly gifts hang off, created on first use.
 *
 * Subscriptions need a Product id — inline `price_data` will not take a bare
 * name — but donors give $37 a month, not $25, so building a Price catalogue
 * per amount would be absurd. One Product per campaign with a per-subscription
 * inline unit amount is the shape that fits.
 */
export const getCampaignProduct = internalQuery({
	args: { campaignId: v.id('campaigns'), stripeAccountId: v.string() },
	handler: async (ctx, args): Promise<string | null> => {
		const row = await ctx.db
			.query('stripeCampaignProducts')
			.withIndex('by_campaignId_and_stripeAccountId', (q) =>
				q.eq('campaignId', args.campaignId).eq('stripeAccountId', args.stripeAccountId)
			)
			.unique();
		return row?.stripeProductId ?? null;
	}
});

export const saveCampaignProduct = internalMutation({
	args: {
		orgId: v.string(),
		campaignId: v.id('campaigns'),
		stripeAccountId: v.string(),
		stripeProductId: v.string()
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('stripeCampaignProducts')
			.withIndex('by_campaignId_and_stripeAccountId', (q) =>
				q.eq('campaignId', args.campaignId).eq('stripeAccountId', args.stripeAccountId)
			)
			.unique();
		// Lost a race with a concurrent first donation. Keep whichever landed
		// first; both products are equivalent and re-pointing would orphan any
		// subscription already created against the other.
		if (existing) return existing.stripeProductId;

		await ctx.db.insert('stripeCampaignProducts', args);
		return args.stripeProductId;
	}
});

export const createPledge = internalMutation({
	args: {
		orgId: v.string(),
		campaignId: v.id('campaigns'),
		projectId: v.optional(v.id('projects')),
		amountCents: v.number(),
		interval: v.union(v.literal('month'), v.literal('year')),
		coverFees: v.boolean(),
		anonymous: v.boolean(),
		designation: v.optional(v.string()),
		stripeAccountId: v.string(),
		stripeCustomerId: v.string(),
		donorEmail: v.optional(v.string()),
		donorName: v.optional(v.string())
	},
	handler: async (ctx, args): Promise<Id<'recurringGifts'>> => {
		return await ctx.db.insert('recurringGifts', {
			...args,
			// Not a pledge until the first payment confirms. A donor who
			// abandons the card form leaves this row here, which is correct —
			// it is what the Subscription at Stripe looks like too.
			status: 'incomplete',
			cancelAtPeriodEnd: false
		});
	}
});

export const attachSubscription = internalMutation({
	args: {
		recurringGiftId: v.id('recurringGifts'),
		stripeSubscriptionId: v.string()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch('recurringGifts', args.recurringGiftId, {
			stripeSubscriptionId: args.stripeSubscriptionId
		});
		return null;
	}
});

export const getPledgeForDonor = internalQuery({
	args: { recurringGiftId: v.id('recurringGifts') },
	handler: async (ctx, args): Promise<Doc<'recurringGifts'> | null> => {
		return await ctx.db.get('recurringGifts', args.recurringGiftId);
	}
});

/**
 * Starts a monthly pledge and returns the secret the card form needs.
 *
 * `payment_behavior: 'default_incomplete'` is what makes this work with the
 * Payment Element: Stripe creates the subscription in an unpaid state and
 * hands back a confirmation secret, rather than trying to charge a card we
 * have not collected yet.
 *
 * `application_fee_percent` rather than a fixed amount, because a subscription
 * bills repeatedly and a fixed cut would not scale with an amount the donor
 * may change. It is set only when we actually take a fee — sending zero has
 * different semantics from sending nothing.
 */
export const createRecurringGift = action({
	args: {
		orgSlug: v.string(),
		campaignSlug: v.string(),
		projectNumber: v.optional(v.string()),
		intendedCents: v.number(),
		coverFees: v.boolean(),
		donorName: v.optional(v.string()),
		donorEmail: v.string(),
		anonymous: v.boolean(),
		designation: v.optional(v.string()),
		website: v.optional(v.string())
	},
	handler: async (
		ctx,
		args
	): Promise<{
		clientSecret: string;
		stripeAccountId: string;
		recurringGiftId: Id<'recurringGifts'>;
		chargedCents: number;
	}> => {
		if (args.website && args.website.trim() !== '') {
			throw new ConvexError('This gift could not be started. Please try again.');
		}

		const livemode = isLivemode();
		const target = await ctx.runQuery(internal.stripe.donations.resolveGiftTarget, {
			orgSlug: args.orgSlug,
			campaignSlug: args.campaignSlug,
			projectNumber: args.projectNumber,
			livemode
		});
		if (!target) {
			throw new ConvexError('This campaign cannot accept gifts right now.');
		}

		const donorEmail = args.donorEmail.trim().toLowerCase();
		const amounts = computeGiftAmounts({
			intendedCents: args.intendedCents,
			coverFees: args.coverFees,
			feeRate: target.feeRate,
			feeFixedCents: target.feeFixedCents,
			platformFeeBps: target.platformFeeBps
		});

		const stripe = stripeClient();
		const options = { stripeAccount: target.stripeAccountId };

		// --- Product, created once per campaign ---
		let productId = await ctx.runQuery(internal.stripe.recurring.getCampaignProduct, {
			campaignId: target.campaignId,
			stripeAccountId: target.stripeAccountId
		});
		if (!productId) {
			const product = await stripe.products.create(
				{
					name: `${target.campaignName} — monthly giving`,
					metadata: { jubilee_campaign_id: target.campaignId, jubilee_org_id: target.orgId }
				},
				{ ...options, idempotencyKey: `product:${target.campaignId}` }
			);
			productId = await ctx.runMutation(internal.stripe.recurring.saveCampaignProduct, {
				orgId: target.orgId,
				campaignId: target.campaignId,
				stripeAccountId: target.stripeAccountId,
				stripeProductId: product.id
			});
		}

		// --- Customer, on the connected account ---
		const customer = await stripe.customers.create(
			{
				email: donorEmail,
				name: args.donorName?.trim() || undefined,
				metadata: { jubilee_org_id: target.orgId }
			},
			{ ...options, idempotencyKey: `cust:${target.orgId}:${donorEmail}` }
		);

		// --- Our row, before the subscription, so its id keys the retry ---
		const recurringGiftId = await ctx.runMutation(internal.stripe.recurring.createPledge, {
			orgId: target.orgId,
			campaignId: target.campaignId,
			projectId: target.projectId,
			amountCents: amounts.chargedCents,
			interval: 'month',
			coverFees: amounts.coverFees,
			anonymous: args.anonymous,
			designation: args.designation?.trim() || undefined,
			stripeAccountId: target.stripeAccountId,
			stripeCustomerId: customer.id,
			donorEmail,
			donorName: args.donorName?.trim() || undefined
		});

		const platformFeePercent = target.platformFeeBps / 100;

		const subscription = await stripe.subscriptions.create(
			{
				customer: customer.id,
				items: [
					{
						price_data: {
							currency: 'usd',
							product: productId,
							unit_amount: amounts.chargedCents,
							recurring: { interval: 'month' }
						}
					}
				],
				payment_behavior: 'default_incomplete',
				payment_settings: { save_default_payment_method: 'on_subscription' },
				...(platformFeePercent > 0 ? { application_fee_percent: platformFeePercent } : {}),
				metadata: {
					jubilee_recurring_gift_id: recurringGiftId,
					jubilee_org_id: target.orgId,
					jubilee_campaign_id: target.campaignId,
					jubilee_meta_v: '1'
				},
				expand: ['latest_invoice.confirmation_secret']
			},
			{ ...options, idempotencyKey: `sub:${recurringGiftId}` }
		);

		await ctx.runMutation(internal.stripe.recurring.attachSubscription, {
			recurringGiftId,
			stripeSubscriptionId: subscription.id
		});

		const invoice = subscription.latest_invoice;
		const clientSecret =
			invoice && typeof invoice !== 'string'
				? (invoice as { confirmation_secret?: { client_secret?: string } }).confirmation_secret
						?.client_secret
				: undefined;

		if (!clientSecret) {
			throw new ConvexError('Stripe did not return a confirmation secret for this pledge.');
		}

		return {
			clientSecret,
			stripeAccountId: target.stripeAccountId,
			recurringGiftId,
			chargedCents: amounts.chargedCents
		};
	}
});

/**
 * Cancels subscriptions on an account that disconnected from us.
 *
 * Stripe does NOT cancel subscriptions when an account is deauthorized, and on
 * direct charges `application_fee_percent` keeps applying afterwards. Without
 * this we would go on charging donors monthly for an organization that has
 * left the platform, and keep taking a cut of it.
 *
 * Best-effort by necessity: deauthorization is exactly the event that may have
 * removed our access to the account, so each cancel is attempted individually
 * and a failure is logged rather than thrown. The local rows were already
 * marked cancelled before this was scheduled, which is the ordering that
 * matters — our surfaces stop showing the pledge as live regardless of what
 * Stripe lets us do.
 */
export const cancelSubscriptionsForAccount = internalAction({
	args: { stripeAccountId: v.string(), subscriptionIds: v.array(v.string()) },
	handler: async (ctx, args): Promise<null> => {
		const stripe = stripeClient();
		for (const subscriptionId of args.subscriptionIds) {
			try {
				// Empty params so the options land third; see `client.ts`.
				await stripe.subscriptions.cancel(
					subscriptionId,
					{},
					{ stripeAccount: args.stripeAccountId }
				);
			} catch (error) {
				console.error(
					`Could not cancel ${subscriptionId} on deauthorized account ${args.stripeAccountId}`,
					error
				);
			}
		}
		return null;
	}
});

/**
 * Donor self-service: change the amount, pause, or cancel a monthly gift.
 *
 * Ours rather than Stripe's Billing customer portal, for two reasons. The
 * portal's documented `on_behalf_of` pattern describes the destination-charge
 * model where the Customer lives on the PLATFORM; for direct charges, where the
 * Customer lives on the connected account, that path is undocumented and needs
 * verifying in a sandbox before anything is built on it. And the portal's copy
 * is commerce copy — "Subscriptions", "Cancel plan" — which donors respond
 * badly to, because they did not buy a plan.
 *
 * The guard is the important part. We are calling into a connected account
 * with platform credentials, so failing to check that this pledge belongs to
 * the org in the URL would be a cross-tenant IDOR: any donor id would reach
 * any org's subscriptions.
 */
export const updateRecurringGift = action({
	args: {
		recurringGiftId: v.id('recurringGifts'),
		donorEmail: v.string(),
		change: v.union(
			v.object({ kind: v.literal('cancel') }),
			v.object({ kind: v.literal('cancelAtPeriodEnd'), value: v.boolean() }),
			v.object({ kind: v.literal('amount'), amountCents: v.number() })
		)
	},
	handler: async (ctx, args): Promise<null> => {
		const pledge = await ctx.runQuery(internal.stripe.recurring.getPledgeForDonor, {
			recurringGiftId: args.recurringGiftId
		});
		if (!pledge || !pledge.stripeSubscriptionId) {
			throw new ConvexError('That monthly gift could not be found.');
		}

		// The ownership check. An id alone is not authorization — the caller
		// must also present the email the pledge was created with.
		if (pledge.donorEmail !== args.donorEmail.trim().toLowerCase()) {
			throw new ConvexError('That monthly gift could not be found.');
		}

		const stripe = stripeClient();
		const options = { stripeAccount: pledge.stripeAccountId };

		switch (args.change.kind) {
			case 'cancel': {
				await stripe.subscriptions.cancel(pledge.stripeSubscriptionId, {}, options);
				await ctx.runMutation(internal.stripe.webhooks.recordSubscriptionStatus, {
					stripeSubscriptionId: pledge.stripeSubscriptionId,
					status: 'canceled'
				});
				return null;
			}
			case 'cancelAtPeriodEnd': {
				await stripe.subscriptions.update(
					pledge.stripeSubscriptionId,
					{ cancel_at_period_end: args.change.value },
					options
				);
				await ctx.runMutation(internal.stripe.webhooks.recordSubscriptionStatus, {
					stripeSubscriptionId: pledge.stripeSubscriptionId,
					status: pledge.status,
					cancelAtPeriodEnd: args.change.value
				});
				return null;
			}
			case 'amount': {
				const subscription = await stripe.subscriptions.retrieve(
					pledge.stripeSubscriptionId,
					{},
					options
				);
				const item = subscription.items.data[0];
				if (!item) throw new ConvexError('That monthly gift has no billable item.');

				const productId = await ctx.runQuery(internal.stripe.recurring.getCampaignProduct, {
					campaignId: pledge.campaignId,
					stripeAccountId: pledge.stripeAccountId
				});
				if (!productId) throw new ConvexError('That campaign is not set up for monthly giving.');

				await stripe.subscriptions.update(
					pledge.stripeSubscriptionId,
					{
						items: [
							{
								id: item.id,
								price_data: {
									currency: 'usd',
									product: productId,
									unit_amount: args.change.amountCents,
									recurring: { interval: pledge.interval }
								}
							}
						],
						// A donor changing their monthly gift is not buying more of
						// something mid-cycle. Proration would bill or credit them
						// immediately, which is not what "change my monthly amount"
						// means to anyone.
						proration_behavior: 'none'
					},
					options
				);

				await ctx.runMutation(internal.stripe.recurring.recordPledgeAmount, {
					recurringGiftId: pledge._id,
					amountCents: args.change.amountCents
				});
				return null;
			}
		}
	}
});

export const recordPledgeAmount = internalMutation({
	args: { recurringGiftId: v.id('recurringGifts'), amountCents: v.number() },
	handler: async (ctx, args) => {
		await ctx.db.patch('recurringGifts', args.recurringGiftId, {
			amountCents: args.amountCents
		});
		return null;
	}
});
