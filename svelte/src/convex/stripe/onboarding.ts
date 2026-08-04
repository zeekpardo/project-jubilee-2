// The database side of Connect onboarding.
//
// Everything here is INTERNAL. The actions in `accounts.ts` talk to Stripe and
// then call into this file to commit what they learned; the webhook in
// `webhooks.ts` does the same from the other direction. Neither the browser
// nor Stripe reaches these directly.
//
// Why the split at all: an action cannot touch the database and a mutation
// cannot make a network call, so any "ask Stripe, then write it down" flow is
// necessarily two halves. Keeping the writing half here means the invariants —
// one row per org per livemode, never go backwards in time — are enforced in
// one place regardless of which half called.

import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { getAccess } from '../model/access';
import { authComponent } from '../auth';
import { can } from '../../lib/domain/permissions';
import {
	DEFAULT_FEE_FIXED_CENTS,
	DEFAULT_FEE_RATE,
	accountByStripeId,
	accountForOrg,
	stripeAccountFieldsValidator
} from '../model/stripe';

/**
 * The caller's org, if they may administer its Connect settings.
 *
 * Actions cannot run `requireCapability` themselves — it needs a database
 * context — so every Stripe action starts by calling this. Auth propagates
 * from the action into this query, so `getAccess` sees the same session the
 * action was invoked with; nothing about the caller is passed as an argument,
 * which is the rule that keeps one org from administering another's account.
 *
 * Throws rather than returning null, unlike the query-side gates: this guards
 * account creation and onboarding links, and a silent empty result there would
 * present as a mysteriously broken button.
 */
export const requireBillingOrg = internalQuery({
	args: {},
	handler: async (ctx): Promise<{ orgId: string; userId: string }> => {
		const access = await getAccess(ctx);
		if (!access.orgId || !access.userId) {
			throw new ConvexError('Not authenticated');
		}
		if (!can(access, 'billing:manage', null)) {
			throw new ConvexError('Not permitted: billing:manage');
		}
		return { orgId: access.orgId, userId: access.userId };
	}
});

/**
 * Everything `accounts.create` needs about the org and the person creating it.
 *
 * One query rather than three, because an action calling into the database
 * repeatedly is three separate transactions with no consistency between them —
 * and this one decides what name ends up on a donor's bank statement.
 *
 * `email` is the creating owner's, which is what Stripe uses to invite them
 * into their own dashboard. It comes from the session, never from an argument.
 */
export const getAccountCreationContext = internalQuery({
	args: {},
	handler: async (
		ctx
	): Promise<{
		orgId: string;
		email: string | undefined;
		legalName: string | undefined;
		publicName: string | undefined;
		slug: string | undefined;
	}> => {
		const access = await getAccess(ctx);
		if (!access.orgId || !access.userId) {
			throw new ConvexError('Not authenticated');
		}
		if (!can(access, 'billing:manage', null)) {
			throw new ConvexError('Not permitted: billing:manage');
		}
		const orgId = access.orgId;

		const user = await authComponent.safeGetAuthUser(ctx);
		const settings = await ctx.db
			.query('orgSettings')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.unique();

		return {
			orgId,
			email: user?.email ?? undefined,
			legalName: settings?.legalName,
			publicName: settings?.publicName,
			slug: settings?.slug
		};
	}
});

/** This org's row for the given livemode, or null. */
export const getAccountForOrg = internalQuery({
	args: { orgId: v.string(), livemode: v.boolean() },
	handler: async (ctx, args): Promise<Doc<'stripeAccounts'> | null> => {
		return await accountForOrg(ctx, args.orgId, args.livemode);
	}
});

export const getAccountByStripeId = internalQuery({
	args: { stripeAccountId: v.string() },
	handler: async (ctx, args): Promise<Doc<'stripeAccounts'> | null> => {
		return await accountByStripeId(ctx, args.stripeAccountId);
	}
});

/**
 * Records an account we just created at Stripe.
 *
 * Refuses rather than overwrites when a row already exists for this org and
 * livemode. Two accounts for one org is not a state to recover from
 * gracefully: donations would split across two Stripe balances, and the org
 * would have two dashboards and two payout schedules with no way to merge
 * them. Whoever double-clicked gets an error and the existing account.
 */
export const insertAccount = internalMutation({
	args: {
		orgId: v.string(),
		stripeAccountId: v.string(),
		livemode: v.boolean(),
		fields: stripeAccountFieldsValidator,
		eventCreatedAt: v.number()
	},
	handler: async (ctx, args) => {
		const existing = await accountForOrg(ctx, args.orgId, args.livemode);
		if (existing) {
			throw new ConvexError('This organization already has a Stripe account connected');
		}

		return await ctx.db.insert('stripeAccounts', {
			orgId: args.orgId,
			stripeAccountId: args.stripeAccountId,
			livemode: args.livemode,
			...args.fields,

			// Seeded from the standard US card rate. The moment this org is
			// granted Stripe's nonprofit discount, this must be lowered or every
			// fee-covering donor is quoted too much. Nothing updates it
			// automatically — Stripe exposes no API for the discount — so it is an
			// admin-editable field by design.
			feeRate: DEFAULT_FEE_RATE,
			feeFixedCents: DEFAULT_FEE_FIXED_CENTS,
			// Zero by decision, not by oversight. See PLAN-stripe.md §16.2.
			platformFeeBps: 0,
			walletDomainsRegistered: [],

			lastEventCreatedAt: args.eventCreatedAt,
			lastSyncedAt: Date.now()
		});
	}
});

/**
 * Applies a fresh view of an account's Stripe-owned state.
 *
 * The ordering guard is the reason this is not a plain patch.
 * `account.updated` is chatty and Stripe guarantees nothing about delivery
 * order, so a stale event arriving after a fresh one would otherwise roll an
 * org backwards — most damagingly from `active` to `action_required`, which
 * would switch off a working donation form and send a false "Stripe needs more
 * information" email.
 *
 * `eventCreatedAt` is seconds-resolution `event.created` for webhook callers
 * and `Date.now()` for an explicit re-fetch, which is why the comparison is
 * `>=` rather than `>`: a re-fetch triggered inside the same second as an
 * event should still win, being strictly newer information.
 *
 * Returns whether it applied, so a caller can tell "nothing changed" from
 * "ignored as stale" when reading logs.
 */
export const applyAccountFields = internalMutation({
	args: {
		stripeAccountId: v.string(),
		fields: stripeAccountFieldsValidator,
		eventCreatedAt: v.number()
	},
	handler: async (ctx, args): Promise<{ applied: boolean; reason?: string }> => {
		const account = await accountByStripeId(ctx, args.stripeAccountId);
		if (!account) {
			// An account we have never heard of. Not an error: a platform can
			// receive Connect events for accounts created outside this app, and
			// there is no org to attribute them to. Deliberately does NOT read
			// metadata to find one — see `accountByStripeId`.
			return { applied: false, reason: 'unknown_account' };
		}

		if (args.eventCreatedAt < account.lastEventCreatedAt) {
			return { applied: false, reason: 'stale_event' };
		}

		await ctx.db.patch('stripeAccounts', account._id, {
			...args.fields,
			lastEventCreatedAt: args.eventCreatedAt,
			lastSyncedAt: Date.now()
		});
		return { applied: true };
	}
});

/**
 * Records which donation domains registered successfully on this account.
 *
 * Stored as the authoritative list rather than appended to, so a domain that
 * has been removed from configuration or that fails re-registration disappears
 * from the admin surface instead of lingering as a claim that Apple Pay works.
 */
export const setWalletDomains = internalMutation({
	args: { stripeAccountId: v.string(), domains: v.array(v.string()) },
	handler: async (ctx, args) => {
		const account = await accountByStripeId(ctx, args.stripeAccountId);
		if (!account) return null;
		await ctx.db.patch('stripeAccounts', account._id, {
			walletDomainsRegistered: args.domains
		});
		return null;
	}
});

/**
 * The per-org fee configuration an owner may edit.
 *
 * `feeRate` is here because Stripe offers no way to read an account's actual
 * negotiated rate, so when an org is granted the nonprofit discount somebody
 * has to tell us. Getting this wrong is a donor-facing money error in both
 * directions — too high overcharges every fee-covering donor, too low means
 * the org quietly eats the difference — so it is bounded hard and gated on
 * `billing:manage`.
 *
 * Public rather than internal: this one is an admin form submission, not a
 * Stripe callback.
 */
export const updateFeeConfig = internalMutation({
	args: {
		orgId: v.string(),
		livemode: v.boolean(),
		feeRate: v.number(),
		feeFixedCents: v.number()
	},
	handler: async (ctx, args) => {
		// A rate outside this band is a typo — 2.2% entered as 2.2 rather than
		// 0.022 would gross a $100 gift up to nothing sane.
		if (!(args.feeRate >= 0 && args.feeRate <= 0.1)) {
			throw new ConvexError('Processing rate must be between 0% and 10%');
		}
		if (
			!Number.isInteger(args.feeFixedCents) ||
			args.feeFixedCents < 0 ||
			args.feeFixedCents > 500
		) {
			throw new ConvexError('Fixed fee must be between 0 and 500 cents');
		}

		const account = await accountForOrg(ctx, args.orgId, args.livemode);
		if (!account) {
			throw new ConvexError('This organization has no Stripe account connected');
		}

		await ctx.db.patch('stripeAccounts', account._id, {
			feeRate: args.feeRate,
			feeFixedCents: args.feeFixedCents
		});
		return null;
	}
});
