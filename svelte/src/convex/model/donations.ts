// Turning a settled Stripe payment into ledger rows.
//
// This is the webhook-side sibling of `transactions/donation.ts`. It writes
// exactly the same pair of rows under exactly the same invariants; the only
// difference is where the authority comes from. The mutation in
// `transactions/donation.ts` gates on `requireCapability(ctx, 'money:write')`,
// which a webhook can never satisfy because there is no session behind it.
// Here, trust comes from a verified Stripe signature and from the fact that
// the org was resolved from the connected account id server-side.
//
// The rule that must not be broken: a `transactions` row means money that
// actually moved. Nothing pending, nothing processing, nothing hoped for.

import { ConvexError } from 'convex/values';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { createContactModel, normalizeEmail } from './contacts';
import { planRefund } from '../../lib/domain/giving';

/**
 * The donor's contact row, created if this is the first time they have given.
 *
 * Matching is by lowercased email within the org, which is the same key
 * `contacts` already enforces uniqueness on. Returns undefined when there is
 * no usable email: an unattributed gift is a real and acceptable outcome, and
 * it still counts toward Raised exactly like a named one.
 *
 * `anonymous` deliberately does NOT suppress contact creation. A donor asking
 * not to be listed publicly is not asking the nonprofit to forget who they
 * are — the org still has to send them a tax receipt, and next year's
 * acknowledgment has to find them.
 */
export async function findOrCreateDonorContact(
	ctx: MutationCtx,
	input: {
		orgId: string;
		email: string | undefined;
		name: string | undefined;
	}
): Promise<Id<'contacts'> | undefined> {
	const emailLower = normalizeEmail(input.email);
	if (emailLower === undefined) return undefined;

	const existing = await ctx.db
		.query('contacts')
		.withIndex('by_orgId_and_emailLower', (q) =>
			q.eq('orgId', input.orgId).eq('emailLower', emailLower)
		)
		.first();
	if (existing) return existing._id;

	// Stripe gives us one free-text name. Splitting on the last space is a
	// heuristic and it is wrong for plenty of names, which is why the whole
	// string is kept as the first name when there is nothing to split — better
	// a person called "Dr. Ada Lovelace III" than a mangled surname.
	const trimmed = input.name?.trim();
	const parts = trimmed ? trimmed.split(/\s+/) : [];
	const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : (trimmed ?? input.email!);
	const lastName = parts.length > 1 ? parts[parts.length - 1] : undefined;

	return await createContactModel(ctx, {
		orgId: input.orgId,
		firstName,
		lastName,
		email: input.email,
		source: 'donation'
	});
}

/**
 * Writes the ledger rows for a gift that has settled, and marks it succeeded.
 *
 * Idempotent by the intent's own status: a redelivered
 * `payment_intent.succeeded` finds the row already `succeeded` and does
 * nothing. Stripe guarantees at-least-once delivery, so this is load-bearing
 * rather than defensive — without it, every redelivery would double the org's
 * Raised total.
 *
 * The transaction and its allocation are written in one mutation so they
 * commit or roll back together, matching the invariant
 * `transactions/donation.ts` documents: split across two writes, a failure
 * between them leaves a gift attributed to nothing — absent from the project's
 * Raised total and sitting as an unallocated remainder in reconciliation.
 *
 * The amount written is `chargedCents`, not `intendedCents`. What the donor
 * paid is what the donor gave, and the covered fee is part of the gift — it is
 * also the number that has to appear on the tax acknowledgment.
 *
 * No `budgetItem`, and deliberately no way to pass one. Budget lines describe
 * how money is spent; a gift is not spend.
 */
export async function writeGiftToLedger(
	ctx: MutationCtx,
	intent: Doc<'donationIntents'>
): Promise<{ transactionId: Id<'transactions'>; alreadyWritten: boolean }> {
	if (intent.status === 'succeeded' && intent.transactionId) {
		return { transactionId: intent.transactionId, alreadyWritten: true };
	}

	if (!Number.isInteger(intent.chargedCents) || intent.chargedCents <= 0) {
		throw new ConvexError('Refusing to write a non-positive gift to the ledger');
	}

	const contactId =
		intent.contactId ??
		(await findOrCreateDonorContact(ctx, {
			orgId: intent.orgId,
			email: intent.donorEmail,
			name: intent.donorName
		}));

	const transactionId = await ctx.db.insert('transactions', {
		orgId: intent.orgId,
		type: 'donation',
		amountCents: intent.chargedCents,
		contactId,
		// ISO date, matching what the manual entry form stores.
		occurredOn: new Date().toISOString().slice(0, 10),
		// `method` and `reference` mirror the manual-entry vocabulary so the
		// Giving table reads consistently, but the authoritative join back to
		// Stripe is `donationIntents.transactionId` — a reference string is
		// free text and nothing enforces it.
		method: 'stripe',
		reference: intent.stripeInvoiceId ?? intent.stripePaymentIntentId
	});

	await ctx.db.insert('allocations', {
		orgId: intent.orgId,
		transactionId,
		campaignId: intent.campaignId,
		projectId: intent.projectId,
		amountCents: intent.chargedCents
	});

	await ctx.db.patch('donationIntents', intent._id, {
		status: 'succeeded',
		transactionId,
		contactId
	});

	return { transactionId, alreadyWritten: false };
}

/**
 * Unwinds a gift, or the part of it the donor got back.
 *
 * `refundedCents` is the CUMULATIVE amount refunded, straight from Stripe's
 * `charge.amount_refunded`, not the size of the latest refund. Stripe reports
 * it that way and it makes this idempotent for free: a redelivered event
 * recomputes the same end state instead of subtracting twice.
 *
 * The partial case is the one that matters and the one that is easy to get
 * wrong. `charge.refunded` fires for a $10 refund of a $100 gift exactly as it
 * does for the full amount, so treating the event as "this gift is gone" would
 * erase ninety dollars the nonprofit still has.
 *
 * A full refund removes the rows rather than posting a negative one. The
 * ledger's invariant is `sum(allocations) <= amountCents` with positive
 * amounts throughout, and `assertPositiveCents` rejects a negative transaction
 * outright — a contra-entry is not representable without changing what a
 * transaction means to every other surface that reads it. Nothing is lost: the
 * `donationIntents` row survives with its status and every Stripe handle, and
 * that is where the history lives.
 *
 * Note that a refund never returns Stripe's processing fee. The org is out
 * that money and no ledger row here can change it.
 */
export async function reverseGiftInLedger(
	ctx: MutationCtx,
	intent: Doc<'donationIntents'>,
	status: 'refunded' | 'disputed',
	refundedCents: number
): Promise<void> {
	let plan = planRefund({
		chargedCents: intent.chargedCents,
		refundedCents,
		allocationCents: []
	});

	if (intent.transactionId) {
		const allocations = await ctx.db
			.query('allocations')
			.withIndex('by_transactionId', (q) => q.eq('transactionId', intent.transactionId!))
			.take(50);

		plan = planRefund({
			chargedCents: intent.chargedCents,
			refundedCents,
			allocationCents: allocations.map((allocation) => allocation.amountCents)
		});

		// Allocations first, then the transaction. Shrinking the transaction
		// while its allocations still summed to the old figure would breach
		// `sum(allocations) <= amountCents` for the width of the mutation —
		// unobservable from outside, but the ordering costs nothing and keeps
		// the invariant true throughout.
		for (const [index, allocation] of allocations.entries()) {
			const next = plan.allocationCents[index];
			if (next <= 0) {
				await ctx.db.delete('allocations', allocation._id);
			} else if (next !== allocation.amountCents) {
				await ctx.db.patch('allocations', allocation._id, { amountCents: next });
			}
		}

		if (plan.removeTransaction) {
			await ctx.db.delete('transactions', intent.transactionId);
		} else {
			await ctx.db.patch('transactions', intent.transactionId, {
				amountCents: plan.remainingCents
			});
		}
	}

	await ctx.db.patch('donationIntents', intent._id, {
		status,
		refundedCents: plan.refundedCents,
		// Only a full reversal detaches the ledger row, because on a partial one
		// there is still a real transaction recording the money the org kept.
		...(plan.removeTransaction ? { transactionId: undefined } : {})
	});
}
