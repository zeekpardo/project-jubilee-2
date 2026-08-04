import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { query } from '../_generated/server';
import { readableOrgId } from '../model/access';
import { isLivemode } from './env';

/**
 * This org's Connect account, or null when it has never started onboarding.
 *
 * Gated on `billing:manage` — owner-only. That capability has existed in
 * `permissions.ts` since the permission matrix was written and has had no call
 * sites at all; this is the first. Connect settings are what it was reserved
 * for, so nothing about the matrix needs to change to use it.
 *
 * Scoped to this deployment's livemode. An org that onboarded in a sandbox and
 * an org that onboarded for real hold two different `acct_` ids, and showing a
 * test account on a production screen would read as "you are taking donations"
 * when no money can move.
 *
 * Returns null rather than throwing when the caller lacks the capability,
 * following `readableOrgId`'s contract: a query re-runs on every subscription
 * tick, and someone whose role changed mid-session should watch the surface
 * empty out instead of fill with errors.
 */
export const getConnectAccount = query({
	args: {},
	handler: async (ctx) => {
		const orgId = await readableOrgId(ctx, 'billing:manage');
		if (!orgId) return null;

		const account = await ctx.db
			.query('stripeAccounts')
			.withIndex('by_orgId_and_livemode', (q) => q.eq('orgId', orgId).eq('livemode', isLivemode()))
			.unique();
		if (!account) return null;

		// A projection, not the row. `status` is the field the UI is meant to
		// branch on; the raw Stripe flags come along for the diagnostics an
		// owner needs when Stripe is unhappy and the reason is not obvious.
		// Nothing outside this org's own account is reachable here.
		return {
			stripeAccountId: account.stripeAccountId,
			livemode: account.livemode,
			status: account.status,

			chargesEnabled: account.chargesEnabled,
			payoutsEnabled: account.payoutsEnabled,
			detailsSubmitted: account.detailsSubmitted,

			requirementsCurrentlyDue: account.requirementsCurrentlyDue,
			requirementsPastDue: account.requirementsPastDue,
			requirementsPendingVerification: account.requirementsPendingVerification,
			requirementsDisabledReason: account.requirementsDisabledReason,
			requirementsCurrentDeadline: account.requirementsCurrentDeadline,

			feeRate: account.feeRate,
			feeFixedCents: account.feeFixedCents,
			platformFeeBps: account.platformFeeBps,
			walletDomainsRegistered: account.walletDomainsRegistered,

			lastSyncedAt: account.lastSyncedAt
		};
	}
});

// ------------------------------------------------------------
// The giving activity surface
// ------------------------------------------------------------
//
// Gated on `money:read` rather than `billing:manage`, and that split is
// deliberate: `/app/admin/giving` configures Stripe and is owner-only, but
// watching donations arrive and issuing a refund is a finance job. A
// nonprofit's bookkeeper is very often an admin and not the owner, and making
// them ask the executive director to refund a duplicate gift would be absurd.
//
// All three read our OWN tables rather than calling Stripe. With direct
// charges we cannot list across the platform anyway, and a page that renders
// from an indexed read keeps working when Stripe is having a bad morning.

/**
 * Online gifts, newest first.
 *
 * Paginated because a successful campaign produces an unbounded number of
 * these, and `.collect()` on a donations table is the query that works fine
 * for a year and then takes an org's admin page down during their biggest
 * giving day.
 */
export const listOnlineGifts = query({
	args: { paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'money:read');
		if (!orgId) {
			return { page: [], isDone: true, continueCursor: '' };
		}

		const result = await ctx.db
			.query('donationIntents')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.order('desc')
			.paginate(args.paginationOpts);

		// Hydrated per row rather than in the client, so the table can show a
		// campaign name without the browser holding a campaign map.
		const page = await Promise.all(
			result.page.map(async (intent) => {
				const campaign = await ctx.db.get('campaigns', intent.campaignId);
				return {
					_id: intent._id,
					_creationTime: intent._creationTime,
					status: intent.status,
					chargedCents: intent.chargedCents,
					refundedCents: intent.refundedCents ?? 0,
					netCents: intent.netCents,
					stripeFeeCents: intent.stripeFeeCents,
					coverFees: intent.coverFees,
					// `anonymous` means "do not show my name PUBLICLY". It is not a
					// secret from the nonprofit's own finance staff, who have to be
					// able to acknowledge and reconcile the gift.
					anonymous: intent.anonymous,
					donorName: intent.donorName,
					donorEmail: intent.donorEmail,
					campaignName: campaign?.name,
					campaignId: intent.campaignId,
					receiptNumber: intent.receiptNumber,
					acknowledgedAt: intent.acknowledgedAt,
					recurring: intent.recurringGiftId !== undefined,
					stripePaymentIntentId: intent.stripePaymentIntentId
				};
			})
		);

		return { ...result, page };
	}
});

/**
 * Recent payouts to the org's bank.
 *
 * Bounded rather than paginated: this answers "did our money arrive", which is
 * a question about the last few weeks. Anyone auditing a year of payouts wants
 * Stripe's own dashboard, which they have.
 */
export const listPayouts = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'money:read');
		if (!orgId) return [];

		return await ctx.db
			.query('stripePayouts')
			.withIndex('by_orgId_and_createdAt', (q) => q.eq('orgId', orgId))
			.order('desc')
			.take(Math.min(args.limit ?? 10, 50));
	}
});

/**
 * Open and recently closed disputes.
 *
 * Surfaced prominently because under direct charges the debit lands on the
 * NONPROFIT's balance and Stripe notifies THEM, not us — so this is the org's
 * problem to act on, with a deadline (`evidenceDueBy`) that passes in silence.
 */
export const listDisputes = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'money:read');
		if (!orgId) return [];

		return await ctx.db
			.query('stripeDisputes')
			.withIndex('by_orgId_and_createdAt', (q) => q.eq('orgId', orgId))
			.order('desc')
			.take(Math.min(args.limit ?? 20, 50));
	}
});
