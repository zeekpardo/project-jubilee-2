// ============================================================
// Stripe Connect: the decisions that must not be made twice
// ============================================================
// Fee arithmetic, the onboarding status machine, and the account -> org
// lookup. Everything here is deliberately free of the Stripe SDK and of
// `ctx` where it can be, because these are the parts that decide what a donor
// is charged and whether an org may be charged at all — and those are worth
// being able to test without a network, a key, or a deployment.
//
// See PLAN-stripe.md §6 and §9.
// ============================================================

import { ConvexError, v } from 'convex/values';
import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import {
	MAX_GIFT_CENTS,
	MIN_FEE_COVER_CENTS,
	MIN_GIFT_CENTS,
	computeGiftAmounts as computeShared,
	giftAmountProblem,
	grossUpForFees,
	platformFeeCents,
	type GiftAmounts
} from '../../lib/domain/giving';

/** Mirrors the `status` union on `stripeAccounts`. */
export type StripeAccountStatus =
	| 'onboarding'
	| 'pending_review'
	| 'action_required'
	| 'charges_only'
	| 'active'
	| 'restricted'
	| 'rejected';

export const stripeAccountStatusValidator = v.union(
	v.literal('onboarding'),
	v.literal('pending_review'),
	v.literal('action_required'),
	v.literal('charges_only'),
	v.literal('active'),
	v.literal('restricted'),
	v.literal('rejected')
);

/**
 * The subset of `Stripe.Account` the status machine actually consumes.
 *
 * Structural rather than `Stripe.Account` so this function can be called with
 * a literal in a test. Every field is optional because Stripe omits rather
 * than nulls, and an account fetched with a different expansion has fewer of
 * them than one delivered by a webhook.
 */
export type AccountFacts = {
	charges_enabled?: boolean | null;
	payouts_enabled?: boolean | null;
	details_submitted?: boolean | null;
	requirements?: {
		disabled_reason?: string | null;
		currently_due?: string[] | null;
		past_due?: string[] | null;
		pending_verification?: string[] | null;
		current_deadline?: number | null;
	} | null;
};

/**
 * Stripe's flags, reduced to the one word the product surface is allowed to
 * branch on.
 *
 * The order of these checks is the whole point. Two of them in particular:
 *
 *   `details_submitted` is NOT a readiness signal. It means "they finished a
 *   form", and treating it as "they can take money" is the single most common
 *   Connect integration bug. Acceptance is gated on `charges_enabled`, below
 *   and nowhere else.
 *
 *   `charges_only` is checked before `active` because it is common rather than
 *   exotic — KYC passes and the bank account fails a micro-deposit, so gifts
 *   keep arriving into a balance the org cannot withdraw. An integration that
 *   collapses it into `active` produces an org that is happy for a month and
 *   furious once.
 */
export function deriveStatus(account: AccountFacts): StripeAccountStatus {
	const requirements = account.requirements;

	// Terminal. Stripe prefixes every rejection reason: rejected.fraud,
	// rejected.terms_of_service, rejected.other.
	if (requirements?.disabled_reason?.startsWith('rejected')) return 'rejected';

	if (!account.details_submitted) return 'onboarding';

	if ((requirements?.past_due?.length ?? 0) > 0) return 'action_required';
	if ((requirements?.currently_due?.length ?? 0) > 0) return 'action_required';

	// Waiting on Stripe rather than on the org — chasing them for documents
	// here would be wrong, so this is a distinct state from action_required.
	if (!account.charges_enabled && (requirements?.pending_verification?.length ?? 0) > 0) {
		return 'pending_review';
	}

	if (!account.charges_enabled) return 'restricted';
	if (!account.payouts_enabled) return 'charges_only';
	return 'active';
}

/**
 * Whether an org in this state may be shown a working donation form.
 *
 * `charges_only` is included: the money reaches the org's Stripe balance and
 * is genuinely theirs, it just cannot be paid out until they fix their bank
 * details. Refusing gifts would punish the donor for the org's typo. The admin
 * surface shouts about it instead.
 */
export function acceptsOnlineGifts(status: StripeAccountStatus): boolean {
	return status === 'active' || status === 'charges_only';
}

/**
 * Everything `stripeAccounts` mirrors from Stripe, in our shape.
 *
 * The normalization lives here, in one function, so that the two callers that
 * produce it — the `account.updated` webhook and an explicit re-fetch — cannot
 * drift into disagreeing about what an account's state means. Whichever
 * arrives second wins, and both must arrive at the same answer for the same
 * account.
 */
export type StripeAccountFields = {
	chargesEnabled: boolean;
	payoutsEnabled: boolean;
	detailsSubmitted: boolean;
	capabilityCardPayments?: string;
	capabilityTransfers?: string;
	requirementsCurrentlyDue: string[];
	requirementsPastDue: string[];
	requirementsPendingVerification: string[];
	requirementsDisabledReason?: string;
	requirementsCurrentDeadline?: number;
	status: StripeAccountStatus;
};

/** Argument shape for the internal mutations that write the above. */
export const stripeAccountFieldsValidator = v.object({
	chargesEnabled: v.boolean(),
	payoutsEnabled: v.boolean(),
	detailsSubmitted: v.boolean(),
	capabilityCardPayments: v.optional(v.string()),
	capabilityTransfers: v.optional(v.string()),
	requirementsCurrentlyDue: v.array(v.string()),
	requirementsPastDue: v.array(v.string()),
	requirementsPendingVerification: v.array(v.string()),
	requirementsDisabledReason: v.optional(v.string()),
	requirementsCurrentDeadline: v.optional(v.number()),
	status: stripeAccountStatusValidator
});

/**
 * `Stripe.Account` reduced to what we store.
 *
 * Typed against the structural `AccountFacts` rather than importing
 * `Stripe.Account`, so this stays callable from a test with a plain object and
 * the SDK's type churn cannot break the one function that decides whether an
 * org can take money.
 */
export function toAccountFields(
	account: AccountFacts & {
		capabilities?: { card_payments?: string; transfers?: string } | null;
	}
): StripeAccountFields {
	const requirements = account.requirements;
	return {
		chargesEnabled: account.charges_enabled === true,
		payoutsEnabled: account.payouts_enabled === true,
		detailsSubmitted: account.details_submitted === true,
		capabilityCardPayments: account.capabilities?.card_payments ?? undefined,
		capabilityTransfers: account.capabilities?.transfers ?? undefined,
		requirementsCurrentlyDue: requirements?.currently_due ?? [],
		requirementsPastDue: requirements?.past_due ?? [],
		requirementsPendingVerification: requirements?.pending_verification ?? [],
		requirementsDisabledReason: requirements?.disabled_reason ?? undefined,
		requirementsCurrentDeadline: requirements?.current_deadline ?? undefined,
		status: deriveStatus(account)
	};
}

// ------------------------------------------------------------
// Fee arithmetic
// ------------------------------------------------------------
//
// The formulas themselves live in `lib/domain/giving.ts`, shared verbatim with
// the donation form. That is deliberate: the donor consents to one number, and
// a form that computes a different total from the server would charge them
// something they never agreed to. This layer adds the parts that only make
// sense server-side — bounds enforcement, and ConvexError messages a donor
// will actually read.

/**
 * Stripe's standard US card rate, used only to seed a NEW account row.
 *
 * Never consulted at charge time. Once an org wins Stripe's nonprofit discount
 * its real rate is ~2.2%, and a constant used during a gross-up would
 * overcharge every fee-covering donor of every discounted org.
 * `stripeAccounts.feeRate` is the value that decides money.
 */
export const DEFAULT_FEE_RATE = 0.029;
export const DEFAULT_FEE_FIXED_CENTS = 30;

export { MIN_GIFT_CENTS, MAX_GIFT_CENTS, MIN_FEE_COVER_CENTS, grossUpForFees, platformFeeCents };

/**
 * The amount to charge for a gift, bounds-checked.
 *
 * Checks the amount twice on purpose: once as the donor meant it, and again
 * after the gross-up, because covering fees can push a legal gift over the
 * ceiling.
 */
export function computeGiftAmounts(input: {
	intendedCents: number;
	coverFees: boolean;
	feeRate: number;
	feeFixedCents: number;
	platformFeeBps: number;
}): GiftAmounts {
	assertGiftAmount(input.intendedCents);
	const amounts = computeShared(input);
	assertGiftAmount(amounts.chargedCents);
	return amounts;
}

export function assertGiftAmount(cents: number): void {
	switch (giftAmountProblem(cents)) {
		case 'invalid':
			throw new ConvexError('Gift amount must be an integer number of cents');
		case 'tooSmall':
			throw new ConvexError(`The smallest gift we can accept is ${MIN_GIFT_CENTS / 100} dollars`);
		case 'tooLarge':
			throw new ConvexError(
				`Gifts above ${MAX_GIFT_CENTS / 100} dollars need to be arranged with the organization directly`
			);
		default:
			return;
	}
}

/**
 * What the donor sees on their bank statement.
 *
 * Worth getting right rather than defaulting: an unrecognized descriptor is a
 * leading cause of "I don't remember this charge" disputes, and a dispute on a
 * direct charge debits the nonprofit. Stripe requires 5–22 characters, at
 * least one letter, and forbids `<`, `>`, `\`, `'`, `"` and `*`.
 *
 * Returns undefined when nothing usable can be built, which lets Stripe fall
 * back to the account's own business name rather than our sending it something
 * it will reject at account-creation time.
 */
export function toStatementDescriptor(name: string | undefined): string | undefined {
	if (!name) return undefined;

	const cleaned = name
		.toUpperCase()
		.replace(/[<>\\'"*]/g, '')
		.replace(/[^A-Z0-9 ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 22)
		.trim();

	if (cleaned.length < 5 || !/[A-Z]/.test(cleaned)) return undefined;
	return cleaned;
}

// ------------------------------------------------------------
// Lookups
// ------------------------------------------------------------

/**
 * The connected account row for a Stripe account id.
 *
 * This is the webhook's only route back to an org. It is deliberately the ONLY
 * such route: a Stripe event also carries `metadata.jubilee_org_id`, but org
 * admins can edit metadata in their own dashboards, so trusting it would let a
 * tenant write into another tenant's ledger. Metadata is a debugging
 * convenience here and never an authorization input.
 */
export async function accountByStripeId(
	ctx: QueryCtx,
	stripeAccountId: string
): Promise<Doc<'stripeAccounts'> | null> {
	return await ctx.db
		.query('stripeAccounts')
		.withIndex('by_stripeAccountId', (q) => q.eq('stripeAccountId', stripeAccountId))
		.unique();
}

export async function accountForOrg(
	ctx: QueryCtx,
	orgId: string,
	livemode: boolean
): Promise<Doc<'stripeAccounts'> | null> {
	return await ctx.db
		.query('stripeAccounts')
		.withIndex('by_orgId_and_livemode', (q) => q.eq('orgId', orgId).eq('livemode', livemode))
		.unique();
}
