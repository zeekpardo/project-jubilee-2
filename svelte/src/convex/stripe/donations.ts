// The donor-facing endpoint: creating a PaymentIntent for a one-time gift.
//
// This is the only PUBLIC Stripe surface in the app, and the only one reached
// without a session — a donor is a stranger by definition. Everything it is
// told by the client is treated as a hint:
//
//   The amount is recomputed server-side from the org's own fee configuration.
//   The client's figure exists to render a total, not to decide one.
//
//   The org and the connected account are resolved from OUR data by slug.
//   Nothing about which Stripe account gets charged comes from the browser.
//
//   Whether the campaign may take money at all is derived from the account's
//   live status, never from a flag a client could pass.

import { ConvexError, v } from 'convex/values';
import { action, internalQuery, query } from '../_generated/server';
import { components, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { RateLimiter, MINUTE, HOUR } from '@convex-dev/rate-limiter';
import { stripeClient } from './client';
import { isLivemode } from './env';
import { orgIdForSlug } from '../model/public';
import { accountForOrg, acceptsOnlineGifts, computeGiftAmounts } from '../model/stripe';

/**
 * Card-testing bursts are the threat, and they are not hypothetical: an open
 * arbitrary-amount endpoint is exactly what a carder wants, and the resulting
 * chargebacks land on the NONPROFIT's dispute ratio, not ours.
 *
 * Keyed by campaign and by donor email rather than by IP, because a Convex
 * action has no access to the caller's address — only an HTTP action does, and
 * moving this flow to one would cost the typed client call for no security
 * gain against an attacker who can rotate addresses anyway.
 *
 * Both are token buckets, so a legitimate burst — a giving-day push, a family
 * giving from one address — is absorbed rather than rejected, while a
 * sustained rate is not.
 */
const rateLimiter = new RateLimiter(components.rateLimiter, {
	donationsPerCampaign: { kind: 'token bucket', rate: 30, period: MINUTE, capacity: 60 },
	donationsPerDonor: { kind: 'token bucket', rate: 5, period: MINUTE, capacity: 8 },
	donationsPerDonorHourly: { kind: 'token bucket', rate: 20, period: HOUR, capacity: 20 }
});

export type GiftTarget = {
	orgId: string;
	campaignId: Id<'campaigns'>;
	campaignName: string;
	projectId: Id<'projects'> | undefined;
	stripeAccountId: string;
	feeRate: number;
	feeFixedCents: number;
	platformFeeBps: number;
};

/**
 * Resolves what a gift is FOR, from public slugs, and whether it can be taken.
 *
 * Internal despite reading only public data, because it returns the connected
 * account id and the org's fee configuration — neither of which the donor's
 * browser has any business seeing, and the account id in particular is
 * something an attacker would want in order to probe a specific nonprofit.
 *
 * Returns null for every failure rather than distinguishing them. "Which orgs
 * exist, which campaigns are published, and which have payments set up" is not
 * a map worth handing to an anonymous caller.
 */
export const resolveGiftTarget = internalQuery({
	args: {
		orgSlug: v.string(),
		campaignSlug: v.string(),
		projectNumber: v.optional(v.string()),
		livemode: v.boolean()
	},
	handler: async (ctx, args): Promise<GiftTarget | null> => {
		const orgId = await orgIdForSlug(ctx, args.orgSlug);
		if (!orgId) return null;

		const campaign = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId_and_slug', (q) => q.eq('orgId', orgId).eq('slug', args.campaignSlug))
			.first();
		if (!campaign || !campaign.isPublished) return null;

		const account = await accountForOrg(ctx, orgId, args.livemode);
		// The gate. `acceptsOnlineGifts` is derived from Stripe's own view of
		// the account, so an org that gets restricted stops taking money without
		// anybody remembering to flip a flag.
		if (!account || !acceptsOnlineGifts(account.status)) return null;

		let projectId: Id<'projects'> | undefined;
		if (args.projectNumber !== undefined) {
			const project = await ctx.db
				.query('projects')
				.withIndex('by_campaignId_and_number', (q) =>
					q.eq('campaignId', campaign._id).eq('number', args.projectNumber!)
				)
				.first();
			// An unpublished or missing project degrades to a campaign-level
			// gift rather than failing. The donor meant to give to this campaign
			// either way, and refusing their money over a routing detail is the
			// worse outcome.
			if (project?.isPublished) projectId = project._id;
		}

		return {
			orgId,
			campaignId: campaign._id,
			campaignName: campaign.name,
			projectId,
			stripeAccountId: account.stripeAccountId,
			feeRate: account.feeRate,
			feeFixedCents: account.feeFixedCents,
			platformFeeBps: account.platformFeeBps
		};
	}
});

/**
 * Creates a PaymentIntent on the org's connected account and returns what the
 * browser needs to mount the Payment Element.
 *
 * Order is deliberate: our `donationIntents` row is written FIRST, because its
 * id is what the idempotency key and the return URL are built from. A Stripe
 * object created before we have somewhere to attach it would be a charge with
 * no ledger home if the next write failed.
 *
 * `stripeAccount` in the request options — the SECOND argument, not a field in
 * the params — is the single line that makes this a direct charge. Without it
 * the platform becomes merchant of record and every legal and fee assumption
 * in PLAN-stripe.md silently inverts.
 */
export const createDonationIntent = action({
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
		dedicationType: v.optional(v.union(v.literal('honor'), v.literal('memory'))),
		dedicationName: v.optional(v.string()),
		message: v.optional(v.string()),
		// The hidden field a person never sees and a bot cannot resist. Anything
		// in it means this is not a donor.
		website: v.optional(v.string())
	},
	handler: async (
		ctx,
		args
	): Promise<{
		clientSecret: string;
		stripeAccountId: string;
		donationIntentId: Id<'donationIntents'>;
		chargedCents: number;
	}> => {
		// Answered with the same generic error a real failure gets, so a bot
		// learns nothing about which of its fields gave it away.
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
		await rateLimiter.limit(ctx, 'donationsPerCampaign', {
			key: target.campaignId,
			throws: true
		});
		await rateLimiter.limit(ctx, 'donationsPerDonor', { key: donorEmail, throws: true });
		await rateLimiter.limit(ctx, 'donationsPerDonorHourly', { key: donorEmail, throws: true });

		// The client sent a total; it is ignored. This is the number the donor
		// is actually charged, and it is computed from the org's own rate.
		const amounts = computeGiftAmounts({
			intendedCents: args.intendedCents,
			coverFees: args.coverFees,
			feeRate: target.feeRate,
			feeFixedCents: target.feeFixedCents,
			platformFeeBps: target.platformFeeBps
		});

		const donationIntentId = await ctx.runMutation(internal.stripe.webhooks.createPendingGift, {
			orgId: target.orgId,
			campaignId: target.campaignId,
			projectId: target.projectId,
			stripeAccountId: target.stripeAccountId,
			intendedCents: amounts.intendedCents,
			chargedCents: amounts.chargedCents,
			coverFees: amounts.coverFees,
			platformFeeCents: amounts.platformFeeCents,
			donorName: args.donorName?.trim() || undefined,
			donorEmail,
			anonymous: args.anonymous,
			designation: args.designation?.trim() || undefined,
			dedicationType: args.dedicationType,
			dedicationName: args.dedicationName?.trim() || undefined,
			message: args.message?.trim() || undefined
		});

		const stripe = stripeClient();
		const intent = await stripe.paymentIntents.create(
			{
				amount: amounts.chargedCents,
				currency: 'usd',
				automatic_payment_methods: { enabled: true },
				// Omitted entirely rather than sent as 0 — Stripe treats an absent
				// application fee differently from a zero one on some paths.
				...(amounts.platformFeeCents > 0
					? { application_fee_amount: amounts.platformFeeCents }
					: {}),
				description: `Donation — ${target.campaignName}`,
				receipt_email: donorEmail,
				// A mirror for whoever is reading the Stripe dashboard during an
				// incident, and nothing more. The webhook resolves this payment
				// against our own table by id; it never trusts these values,
				// because a connected-account admin can edit them.
				metadata: {
					jubilee_donation_intent_id: donationIntentId,
					jubilee_org_id: target.orgId,
					jubilee_campaign_id: target.campaignId,
					jubilee_intended_cents: String(amounts.intendedCents),
					jubilee_charged_cents: String(amounts.chargedCents),
					jubilee_cover_fees: String(amounts.coverFees),
					jubilee_anonymous: String(args.anonymous),
					jubilee_meta_v: '1'
				}
			},
			{
				stripeAccount: target.stripeAccountId,
				// Idempotency keys are scoped per connected account, so our own
				// id is enough to make them unique. Reusing this key with
				// different parameters is an error at Stripe, which is precisely
				// the safety net wanted: a retry either replays the same intent
				// or fails loudly.
				idempotencyKey: `pi_create:${donationIntentId}`
			}
		);

		if (!intent.client_secret) {
			throw new ConvexError('Stripe did not return a client secret for this gift.');
		}

		await ctx.runMutation(internal.stripe.webhooks.attachPaymentIntent, {
			donationIntentId,
			stripePaymentIntentId: intent.id
		});

		return {
			clientSecret: intent.client_secret,
			stripeAccountId: target.stripeAccountId,
			donationIntentId,
			chargedCents: amounts.chargedCents
		};
	}
});

/**
 * What the donation form needs before a donor has committed to anything:
 * whether giving is on, and what a fee-covering gift would actually cost.
 *
 * Public and unauthenticated, like the page it serves. It exposes the org's
 * processing rate, which is not a secret — it is printed on the form the
 * moment a donor toggles fee-cover — but deliberately NOT the connected
 * account id, which only appears once a real intent exists.
 */
export const getGivingStatus = query({
	args: {
		orgSlug: v.string(),
		campaignSlug: v.string()
	},
	handler: async (
		ctx,
		args
	): Promise<{ acceptsGifts: boolean; feeRate: number; feeFixedCents: number } | null> => {
		const orgId = await orgIdForSlug(ctx, args.orgSlug);
		if (!orgId) return null;

		const campaign = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId_and_slug', (q) => q.eq('orgId', orgId).eq('slug', args.campaignSlug))
			.first();
		if (!campaign || !campaign.isPublished) return null;

		const account = await accountForOrg(ctx, orgId, isLivemode());
		if (!account) return { acceptsGifts: false, feeRate: 0, feeFixedCents: 0 };

		return {
			acceptsGifts: acceptsOnlineGifts(account.status),
			feeRate: account.feeRate,
			feeFixedCents: account.feeFixedCents
		};
	}
});

/**
 * The thanks page's subscription.
 *
 * Public, and safe because the donation id is an unguessable Convex id handed
 * only to the browser that created the gift. It returns the gift's own
 * details and nothing about the org's Stripe configuration.
 *
 * This is materially better than Stripe's own documented pattern, which polls
 * `retrievePaymentIntent` on a timer: the row updates reactively the moment
 * the webhook lands, so a donor watching the page sees "confirmed" without
 * refreshing — and an ACH gift can honestly say "we're confirming this" for as
 * long as that remains true.
 */
export const getGiftStatus = query({
	args: { donationIntentId: v.id('donationIntents') },
	handler: async (ctx, args) => {
		const intent = await ctx.db.get('donationIntents', args.donationIntentId);
		if (!intent) return null;

		const campaign = await ctx.db.get('campaigns', intent.campaignId);
		return {
			status: intent.status,
			chargedCents: intent.chargedCents,
			coverFees: intent.coverFees,
			donorName: intent.donorName,
			campaignName: campaign?.name,
			receiptNumber: intent.receiptNumber,
			acknowledgedAt: intent.acknowledgedAt
		};
	}
});
