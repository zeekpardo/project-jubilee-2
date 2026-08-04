// Tax acknowledgments for online gifts.
//
// This is not a nicety bolted onto the payment flow. A 501(c)(3) that cannot
// substantiate its gifts has a compliance problem rather than a missing
// feature, and Stripe does not produce these documents — its receipt is a
// payment receipt and carries neither the charity's EIN nor the
// goods-and-services statement the IRS requires. See
// `model/emails/templates/donationTemplates.ts` for what the statute wants.
//
// Two rules shape everything here:
//
//   Never acknowledge a gift that has not settled. ACH sits in `processing`
//   for days and can still fail; a receipt issued then would have to be
//   retracted, which is worse than one sent late.
//
//   Never reuse or skip a receipt number. The series is per org per calendar
//   year and gapless, because that is the first thing anyone auditing a
//   nonprofit's receipts checks.

import { ConvexError, v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import { resend, emailBrand, emailSendFrom } from '../email';
import {
	renderDonationAcknowledgment,
	renderDonationAcknowledgmentVoid
} from '../model/emails/templates/donationTemplates';
import { formatCents } from '../../lib/features/money/format';

type AcknowledgmentContext = {
	orgLegalName: string;
	orgEin: string | undefined;
	acknowledgmentText: string | undefined;
	donorName: string | undefined;
	donorEmail: string | undefined;
	amountCents: number;
	giftDate: string;
	campaignName: string | undefined;
	designation: string | undefined;
	receiptNumber: string | undefined;
	alreadyAcknowledged: boolean;
	status: string;
};

/**
 * Everything one acknowledgment needs, read in a single transaction.
 *
 * `orgLegalName` falls back through `publicName` before giving up. An org that
 * has not filled in its legal name yet still has donors, and a receipt naming
 * them imperfectly is far better than no receipt at all — but a receipt naming
 * nobody is not sendable, so that case returns null and is logged.
 */
export const getAcknowledgmentContext = internalQuery({
	args: { donationIntentId: v.id('donationIntents') },
	handler: async (ctx, args): Promise<AcknowledgmentContext | null> => {
		const intent = await ctx.db.get('donationIntents', args.donationIntentId);
		if (!intent) return null;

		const settings = await ctx.db
			.query('orgSettings')
			.withIndex('by_orgId', (q) => q.eq('orgId', intent.orgId))
			.unique();

		const campaign = await ctx.db.get('campaigns', intent.campaignId);

		const orgLegalName = settings?.legalName ?? settings?.publicName;
		if (!orgLegalName) return null;

		return {
			orgLegalName,
			orgEin: settings?.ein,
			acknowledgmentText: settings?.acknowledgmentText,
			donorName: intent.donorName,
			donorEmail: intent.donorEmail,
			// The amount CHARGED, which includes any fee the donor chose to
			// cover. That is the cash they parted with, so that is the
			// deductible figure.
			amountCents: intent.chargedCents,
			giftDate: new Date(intent._creationTime).toISOString().slice(0, 10),
			campaignName: campaign?.name,
			designation: intent.designation,
			receiptNumber: intent.receiptNumber,
			alreadyAcknowledged: intent.acknowledgedAt !== undefined,
			status: intent.status
		};
	}
});

/**
 * Stamps a gift with the next number in its org's series for the year.
 *
 * Idempotent: a gift that already has a number keeps it. That matters because
 * this runs off a webhook, and a redelivered `payment_intent.succeeded` must
 * not burn a second number or produce a second receipt with different
 * identifying text for the same gift.
 *
 * The counter is read and incremented inside this one mutation, so two
 * donations landing in the same instant serialize rather than colliding —
 * which is exactly why it is a counter row and not a count of existing
 * receipts.
 */
export const assignReceiptNumber = internalMutation({
	args: { donationIntentId: v.id('donationIntents') },
	handler: async (ctx, args): Promise<string | null> => {
		const intent = await ctx.db.get('donationIntents', args.donationIntentId);
		if (!intent) return null;
		if (intent.receiptNumber) return intent.receiptNumber;

		// Only settled money gets a number. Anything else and the series would
		// carry entries for gifts that never happened.
		if (intent.status !== 'succeeded') return null;

		const year = new Date(intent._creationTime).getUTCFullYear();
		const counter = await ctx.db
			.query('receiptCounters')
			.withIndex('by_orgId_and_year', (q) => q.eq('orgId', intent.orgId).eq('year', year))
			.unique();

		let next: number;
		if (counter) {
			next = counter.nextNumber;
			await ctx.db.patch('receiptCounters', counter._id, { nextNumber: next + 1 });
		} else {
			next = 1;
			await ctx.db.insert('receiptCounters', {
				orgId: intent.orgId,
				year,
				nextNumber: 2
			});
		}

		const receiptNumber = `${year}-${String(next).padStart(4, '0')}`;
		await ctx.db.patch('donationIntents', args.donationIntentId, { receiptNumber });
		return receiptNumber;
	}
});

export const markAcknowledged = internalMutation({
	args: { donationIntentId: v.id('donationIntents') },
	handler: async (ctx, args) => {
		await ctx.db.patch('donationIntents', args.donationIntentId, {
			acknowledgedAt: Date.now()
		});
		return null;
	}
});

export const markAcknowledgmentVoided = internalMutation({
	args: { donationIntentId: v.id('donationIntents') },
	handler: async (ctx, args) => {
		await ctx.db.patch('donationIntents', args.donationIntentId, {
			acknowledgmentVoidedAt: Date.now()
		});
		return null;
	}
});

/**
 * Sends the acknowledgment for a settled gift.
 *
 * Scheduled from the mutation that wrote the gift to the ledger rather than
 * called inline, for two reasons: a mutation cannot make a network call at
 * all, and a mail failure must never roll back a donation we have already
 * accepted. A gift recorded without its receipt is recoverable; a receipt sent
 * for a gift that rolled back is not.
 */
export const sendAcknowledgment = internalAction({
	args: { donationIntentId: v.id('donationIntents') },
	handler: async (ctx, args): Promise<null> => {
		const receiptNumber = await ctx.runMutation(internal.stripe.receipts.assignReceiptNumber, {
			donationIntentId: args.donationIntentId
		});
		if (!receiptNumber) return null;

		const context = await ctx.runQuery(internal.stripe.receipts.getAcknowledgmentContext, {
			donationIntentId: args.donationIntentId
		});
		if (!context) {
			console.error(
				`No acknowledgment context for ${args.donationIntentId} — the org has no legal or public name set`
			);
			return null;
		}
		if (context.status !== 'succeeded') return null;
		if (context.alreadyAcknowledged) return null;
		if (!context.donorEmail) {
			// A gift with no email. Rare online, since we ask for one to send the
			// receipt, but a recurring pledge whose donor removed theirs would
			// land here. Nothing to do but say so.
			console.error(`Cannot acknowledge ${args.donationIntentId}: no donor email`);
			return null;
		}

		await resend.sendEmail(ctx, {
			from: emailSendFrom(),
			to: context.donorEmail,
			subject: `Your gift to ${context.orgLegalName}`,
			html: renderDonationAcknowledgment({
				orgLegalName: context.orgLegalName,
				orgEin: context.orgEin,
				donorName: context.donorName,
				amountFormatted: formatCents(context.amountCents),
				giftDate: context.giftDate,
				receiptNumber,
				campaignName: context.campaignName,
				designation: context.designation,
				acknowledgmentText: context.acknowledgmentText,
				...emailBrand()
			})
		});

		await ctx.runMutation(internal.stripe.receipts.markAcknowledged, {
			donationIntentId: args.donationIntentId
		});
		return null;
	}
});

/**
 * Retracts an acknowledgment after a refund or a dispute.
 *
 * Only sends when one was actually issued — a gift refunded before its receipt
 * went out needs no correction, and telling a donor their receipt is void when
 * they never received one is its own kind of alarming.
 */
export const voidAcknowledgment = internalAction({
	args: {
		donationIntentId: v.id('donationIntents'),
		reason: v.union(v.literal('refunded'), v.literal('disputed'))
	},
	handler: async (ctx, args): Promise<null> => {
		const context = await ctx.runQuery(internal.stripe.receipts.getAcknowledgmentContext, {
			donationIntentId: args.donationIntentId
		});
		if (!context || !context.alreadyAcknowledged || !context.receiptNumber) return null;
		if (!context.donorEmail) return null;

		await resend.sendEmail(ctx, {
			from: emailSendFrom(),
			to: context.donorEmail,
			subject: `Receipt ${context.receiptNumber} has been voided`,
			html: renderDonationAcknowledgmentVoid({
				orgLegalName: context.orgLegalName,
				donorName: context.donorName,
				amountFormatted: formatCents(context.amountCents),
				receiptNumber: context.receiptNumber,
				reason: args.reason,
				...emailBrand()
			})
		});

		await ctx.runMutation(internal.stripe.receipts.markAcknowledgmentVoided, {
			donationIntentId: args.donationIntentId
		});
		return null;
	}
});

/** Guards against a caller wiring this up with an unusable amount. */
export function assertReceiptable(amountCents: number): void {
	if (!Number.isInteger(amountCents) || amountCents <= 0) {
		throw new ConvexError('Cannot acknowledge a non-positive gift');
	}
}
