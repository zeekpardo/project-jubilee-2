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
