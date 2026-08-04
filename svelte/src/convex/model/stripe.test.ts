import { describe, expect, it } from 'vitest';
import {
	acceptsOnlineGifts,
	deriveStatus,
	toAccountFields,
	toStatementDescriptor,
	type AccountFacts
} from './stripe';

// `deriveStatus` takes a structural type rather than `Stripe.Account`
// precisely so it can be exercised like this — with no key, no network and no
// deployment. It decides whether an organization is allowed to take money, so
// it is the single most important pure function in the integration.

const onboarded: AccountFacts = {
	charges_enabled: true,
	payouts_enabled: true,
	details_submitted: true,
	requirements: {
		currently_due: [],
		past_due: [],
		pending_verification: []
	}
};

describe('deriveStatus', () => {
	it('is active for a fully onboarded account', () => {
		expect(deriveStatus(onboarded)).toBe('active');
	});

	it('is onboarding before the form is finished', () => {
		expect(deriveStatus({ ...onboarded, details_submitted: false })).toBe('onboarding');
	});

	it('NEVER reports active on details_submitted alone', () => {
		// The single most common Connect integration bug: `details_submitted`
		// means "they finished a form", not "they can take money". An account in
		// this state must not be shown a working donation form.
		const submittedButNotEnabled: AccountFacts = {
			charges_enabled: false,
			payouts_enabled: false,
			details_submitted: true,
			requirements: { currently_due: [], past_due: [], pending_verification: [] }
		};
		const status = deriveStatus(submittedButNotEnabled);
		expect(status).not.toBe('active');
		expect(acceptsOnlineGifts(status)).toBe(false);
	});

	it('is charges_only when payouts are blocked but charges work', () => {
		// Common rather than exotic: KYC passes and the bank account fails a
		// micro-deposit. Gifts keep arriving into a balance the org cannot
		// withdraw, so this must be distinguishable from `active`.
		const status = deriveStatus({ ...onboarded, payouts_enabled: false });
		expect(status).toBe('charges_only');
		// Still accepts gifts: the money is genuinely theirs, and refusing it
		// would punish the donor for the org's typo.
		expect(acceptsOnlineGifts(status)).toBe(true);
	});

	it('is action_required when Stripe is waiting on the org', () => {
		expect(
			deriveStatus({
				...onboarded,
				requirements: { currently_due: ['company.tax_id'], past_due: [], pending_verification: [] }
			})
		).toBe('action_required');
	});

	it('prioritises past_due over currently_due', () => {
		expect(
			deriveStatus({
				...onboarded,
				requirements: {
					currently_due: ['a'],
					past_due: ['company.verification.document'],
					pending_verification: []
				}
			})
		).toBe('action_required');
	});

	it('is pending_review when Stripe is the one still working', () => {
		// Distinct from action_required on purpose: chasing the org for
		// documents Stripe already has would be the wrong message.
		expect(
			deriveStatus({
				charges_enabled: false,
				payouts_enabled: false,
				details_submitted: true,
				requirements: {
					currently_due: [],
					past_due: [],
					pending_verification: ['company.verification.document']
				}
			})
		).toBe('pending_review');
	});

	it('is rejected for every rejected.* disabled reason, and that wins outright', () => {
		for (const reason of ['rejected.fraud', 'rejected.terms_of_service', 'rejected.other']) {
			expect(deriveStatus({ ...onboarded, requirements: { disabled_reason: reason } })).toBe(
				'rejected'
			);
		}
	});

	it('is restricted when charges are off with nothing outstanding to explain it', () => {
		expect(
			deriveStatus({
				charges_enabled: false,
				payouts_enabled: false,
				details_submitted: true,
				requirements: { currently_due: [], past_due: [], pending_verification: [] }
			})
		).toBe('restricted');
	});

	it('treats a bare account with no requirements object as onboarding', () => {
		expect(deriveStatus({})).toBe('onboarding');
	});
});

describe('acceptsOnlineGifts', () => {
	it('permits only active and charges_only', () => {
		expect(acceptsOnlineGifts('active')).toBe(true);
		expect(acceptsOnlineGifts('charges_only')).toBe(true);
		for (const status of [
			'onboarding',
			'pending_review',
			'action_required',
			'restricted',
			'rejected'
		] as const) {
			expect(acceptsOnlineGifts(status)).toBe(false);
		}
	});
});

describe('toAccountFields', () => {
	it('coerces Stripe omissions into concrete values', () => {
		// Stripe omits rather than nulls, and a webhook payload carries fewer
		// fields than a retrieve. Everything must land defined.
		const fields = toAccountFields({});
		expect(fields.chargesEnabled).toBe(false);
		expect(fields.payoutsEnabled).toBe(false);
		expect(fields.detailsSubmitted).toBe(false);
		expect(fields.requirementsCurrentlyDue).toEqual([]);
		expect(fields.requirementsPastDue).toEqual([]);
		expect(fields.status).toBe('onboarding');
	});

	it('carries capabilities and requirements through', () => {
		const fields = toAccountFields({
			...onboarded,
			capabilities: { card_payments: 'active', transfers: 'active' }
		});
		expect(fields.capabilityCardPayments).toBe('active');
		expect(fields.capabilityTransfers).toBe('active');
		expect(fields.status).toBe('active');
	});
});

describe('toStatementDescriptor', () => {
	it('uppercases and strips characters Stripe rejects', () => {
		// The apostrophe and angle brackets are on Stripe's forbidden list. They
		// are removed outright rather than replaced with a space, so a
		// possessive stays one word instead of becoming "HABITAT S".
		expect(toStatementDescriptor("Habitat's <ReStore>")).toBe('HABITATS RESTORE');
	});

	it('collapses punctuation into single spaces', () => {
		expect(toStatementDescriptor('Food-Bank, Inc.')).toBe('FOOD BANK INC');
	});

	it('truncates to 22 characters', () => {
		const descriptor = toStatementDescriptor('Habitat for Humanity of Tulsa County Incorporated');
		expect(descriptor!.length).toBeLessThanOrEqual(22);
	});

	it('returns undefined rather than something Stripe will reject', () => {
		// Better to let Stripe fall back to the account's business name than to
		// fail account creation on a descriptor.
		expect(toStatementDescriptor(undefined)).toBeUndefined();
		expect(toStatementDescriptor('AB')).toBeUndefined();
		expect(toStatementDescriptor('12345')).toBeUndefined();
	});
});
