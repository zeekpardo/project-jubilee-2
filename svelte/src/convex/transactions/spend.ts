import { ConvexError, v } from 'convex/values';
import { mutation } from '../functions';
import { requireCapability } from '../model/access';
import { assertPositiveCents, requireProjectInCampaign } from '../model/money';

/**
 * An upload target for a spend receipt. Gated on the same capability as the
 * spend itself so a reader cannot push bytes into org storage.
 */
export const generateReceiptUploadUrl = mutation({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, args) => {
		await requireCapability(ctx, 'money:write', args.campaignId);
		return await ctx.storage.generateUploadUrl();
	}
});

/**
 * Drop a receipt blob that never made it onto a transaction.
 *
 * The upload is a separate round trip from `recordProjectSpend`, so a mutation
 * that throws after a successful upload leaves the bytes in storage with
 * nothing pointing at them. The client calls this to take them back out.
 *
 * Gated on `money:write` for the campaign — the same capability that minted
 * the upload URL — so this cannot become a way for a reader to delete storage
 * out from under anyone. It stays deliberately dumb about *which* blob: the
 * caller passes the id it just received, and a `money:write` holder deleting a
 * blob they could have overwritten anyway is not an escalation.
 */
export const discardReceipt = mutation({
	args: {
		campaignId: v.id('campaigns'),
		storageId: v.id('_storage')
	},
	handler: async (ctx, args) => {
		await requireCapability(ctx, 'money:write', args.campaignId);
		await ctx.storage.delete(args.storageId);
		return null;
	}
});

/**
 * Record a real expenditure against one budget line of one project.
 *
 * The expenditure transaction and the allocation that attributes it are
 * written by this single mutation, so they commit or roll back together. Split
 * across two client calls, a failure between them would leave money in the
 * ledger attributed to nobody — it would silently land in the "Unassigned" row
 * and skew reconciliation.
 *
 * `budgetItem` is the raw ledger key: a `templateSnapshot` key such as
 * 'rent_cents', the literal 'debt', or an extra's label. It is what the budget
 * ledger matches on, so an empty tag is rejected rather than quietly becoming
 * untagged spend.
 */
export const recordProjectSpend = mutation({
	args: {
		projectId: v.id('projects'),
		campaignId: v.id('campaigns'),
		budgetItem: v.string(),
		amountCents: v.number(),
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

		const budgetItem = args.budgetItem.trim();
		if (budgetItem === '') {
			throw new ConvexError('A budget line is required');
		}

		await requireProjectInCampaign(ctx, orgId, args.projectId, args.campaignId);

		const transactionId = await ctx.db.insert('transactions', {
			orgId,
			type: 'expenditure',
			amountCents: args.amountCents,
			occurredOn: args.occurredOn?.trim() || undefined,
			method: args.method?.trim() || undefined,
			reference: args.reference?.trim() || undefined,
			receiptStorageId: args.receiptStorageId
		});

		// The whole amount is attributed to this one line, so the
		// sum(allocations) <= amountCents invariant holds by construction.
		const allocationId = await ctx.db.insert('allocations', {
			orgId,
			transactionId,
			campaignId: args.campaignId,
			projectId: args.projectId,
			amountCents: args.amountCents,
			budgetItem
		});

		return { transactionId, allocationId };
	}
});
