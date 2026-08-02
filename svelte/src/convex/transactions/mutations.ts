import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireCapability } from '../model/access';
import {
	allocationsForTransaction,
	assertAmountCoversAllocations,
	assertNonNegativeCents,
	requireTransaction,
	transactionTypeValidator
} from '../model/money';

type TransactionPatch = Partial<Omit<Doc<'transactions'>, '_id' | '_creationTime' | 'orgId'>>;

async function requireContact(
	ctx: MutationCtx,
	orgId: string,
	contactId: Id<'contacts'>
): Promise<Doc<'contacts'>> {
	const contact = await ctx.db.get('contacts', contactId);
	if (!contact || contact.orgId !== orgId) {
		throw new ConvexError('Contact not found');
	}
	return contact;
}

export const createTransaction = mutation({
	args: {
		type: transactionTypeValidator,
		amountCents: v.number(),
		occurredOn: v.optional(v.string()),
		method: v.optional(v.string()),
		reference: v.optional(v.string()),
		receiptUrl: v.optional(v.string()),
		contactId: v.optional(v.id('contacts')),
		note: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'money:write');
		assertNonNegativeCents('amountCents', args.amountCents);
		if (args.contactId !== undefined) {
			await requireContact(ctx, orgId, args.contactId);
		}

		return await ctx.db.insert('transactions', { ...args, orgId });
	}
});

export const updateTransaction = mutation({
	args: {
		transactionId: v.id('transactions'),
		type: v.optional(transactionTypeValidator),
		amountCents: v.optional(v.number()),
		occurredOn: v.optional(v.string()),
		method: v.optional(v.string()),
		reference: v.optional(v.string()),
		receiptUrl: v.optional(v.string()),
		receiptStorageId: v.optional(v.id('_storage')),
		contactId: v.optional(v.id('contacts')),
		clearContact: v.optional(v.boolean()),
		note: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'money:write');
		const transaction = await requireTransaction(ctx, orgId, args.transactionId);

		if (args.clearContact === true && args.contactId !== undefined) {
			throw new ConvexError('Pass either contactId or clearContact, not both');
		}

		// Each field is copied only when supplied: patching an absent optional
		// with undefined would delete the stored value.
		const patch: TransactionPatch = {};
		if (args.type !== undefined) {
			patch.type = args.type;
		}
		if (args.amountCents !== undefined) {
			assertNonNegativeCents('amountCents', args.amountCents);
			await assertAmountCoversAllocations(ctx, transaction, args.amountCents);
			patch.amountCents = args.amountCents;
		}
		if (args.occurredOn !== undefined) {
			patch.occurredOn = args.occurredOn;
		}
		if (args.method !== undefined) {
			patch.method = args.method;
		}
		if (args.reference !== undefined) {
			patch.reference = args.reference;
		}
		if (args.receiptUrl !== undefined) {
			patch.receiptUrl = args.receiptUrl;
		}
		// Replacing an uploaded receipt drops the blob it displaces, exactly as
		// `setProjectPhoto` does — otherwise the old bytes are unreachable but
		// still billed.
		if (args.receiptStorageId !== undefined) {
			if (transaction.receiptStorageId && transaction.receiptStorageId !== args.receiptStorageId) {
				await ctx.storage.delete(transaction.receiptStorageId);
			}
			patch.receiptStorageId = args.receiptStorageId;
		}
		if (args.contactId !== undefined) {
			await requireContact(ctx, orgId, args.contactId);
			patch.contactId = args.contactId;
		}
		// The one field an absent value cannot express: clearing is opt-in via
		// clearContact, and patching contactId to undefined deletes it.
		if (args.clearContact === true) {
			patch.contactId = undefined;
		}
		if (args.note !== undefined) {
			patch.note = args.note;
		}

		await ctx.db.patch('transactions', transaction._id, patch);
		return transaction._id;
	}
});

export const deleteTransaction = mutation({
	args: {
		transactionId: v.id('transactions')
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'money:write');
		const transaction = await requireTransaction(ctx, orgId, args.transactionId);

		// Convex has no cascade: the transaction's allocations would otherwise
		// outlive the money they attribute.
		const allocations = await allocationsForTransaction(ctx, transaction._id);
		for (const allocation of allocations) {
			await ctx.db.delete('allocations', allocation._id);
		}

		// The receipt blob goes first. Once the row is gone `receiptStorageId` is
		// the only handle to it, so a blob dropped after the delete is stranded
		// in storage forever, invisibly.
		if (transaction.receiptStorageId) {
			await ctx.storage.delete(transaction.receiptStorageId);
		}

		await ctx.db.delete('transactions', transaction._id);
		return null;
	}
});
