import { v } from 'convex/values';
import { mutation } from '../functions';
import { requireCapability } from '../model/access';
import { requireContact } from '../model/contacts';
import { assertPositiveCents, requireProjectInCampaign } from '../model/money';

/**
 * Record a donation received for one project — the inflow twin of
 * `recordProjectSpend`.
 *
 * The donation transaction and the allocation that attributes it to the
 * project are written by this single mutation, so they commit or roll back
 * together. Split across two client calls, a failure between them would leave
 * a gift in the ledger attributed to no project: absent from the project's
 * Raised total, and sitting as an unallocated remainder in reconciliation.
 *
 * No `budgetItem` is set, and there is deliberately no way to pass one. Budget
 * lines describe how money is spent; a gift is not spend, and tagging one
 * would post donor money into a spend column.
 *
 * `contactId` is the donor and is optional — anonymous gifts are real, and an
 * unattributed donation still counts toward Raised exactly like a named one.
 *
 * Receipts ride on `receiptStorageId`, which belongs to a transaction of any
 * type. The upload URL and the cleanup for an orphaned blob are the ones in
 * `./spend`: one upload path and one cleanup path, not one per money flow.
 */
export const recordProjectDonation = mutation({
	args: {
		projectId: v.id('projects'),
		campaignId: v.id('campaigns'),
		amountCents: v.number(),
		contactId: v.optional(v.id('contacts')),
		occurredOn: v.optional(v.string()),
		method: v.optional(v.string()),
		reference: v.optional(v.string()),
		receiptStorageId: v.optional(v.id('_storage'))
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'money:write', args.campaignId);

		// Never trust the form: the amount is re-validated here because this is
		// the only place the ledger's integer-cents invariant can be enforced.
		assertPositiveCents('amountCents', args.amountCents);

		await requireProjectInCampaign(ctx, orgId, args.projectId, args.campaignId);

		// A donor id from another org would attach a stranger's name to this
		// org's money — and read one back out on every Giving row.
		if (args.contactId !== undefined) {
			await requireContact(ctx, orgId, args.contactId);
		}

		const transactionId = await ctx.db.insert('transactions', {
			orgId,
			type: 'donation',
			amountCents: args.amountCents,
			contactId: args.contactId,
			occurredOn: args.occurredOn?.trim() || undefined,
			method: args.method?.trim() || undefined,
			reference: args.reference?.trim() || undefined,
			receiptStorageId: args.receiptStorageId
		});

		// The whole gift lands on this one project, so `raisedForProject` counts
		// all of it and the sum(allocations) <= amountCents invariant holds by
		// construction.
		const allocationId = await ctx.db.insert('allocations', {
			orgId,
			transactionId,
			campaignId: args.campaignId,
			projectId: args.projectId,
			amountCents: args.amountCents
		});

		return { transactionId, allocationId };
	}
});
