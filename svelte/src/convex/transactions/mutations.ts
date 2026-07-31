import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { requireOrgId } from '../model/auth';
import {
	allocationsForTransaction,
	assertAmountCoversAllocations,
	assertNonNegativeCents,
	requireTransaction,
	transactionTypeValidator
} from '../model/money';

type TransactionPatch = Partial<Omit<Doc<'transactions'>, '_id' | '_creationTime' | 'orgId'>>;

export const createTransaction = mutation({
	args: {
		type: transactionTypeValidator,
		amountCents: v.number(),
		occurredOn: v.optional(v.string()),
		method: v.optional(v.string()),
		reference: v.optional(v.string()),
		receiptUrl: v.optional(v.string()),
		note: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		assertNonNegativeCents('amountCents', args.amountCents);

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
		note: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const transaction = await requireTransaction(ctx, orgId, args.transactionId);

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
		const orgId = await requireOrgId(ctx);
		const transaction = await requireTransaction(ctx, orgId, args.transactionId);

		// Convex has no cascade: the transaction's allocations would otherwise
		// outlive the money they attribute.
		const allocations = await allocationsForTransaction(ctx, transaction._id);
		for (const allocation of allocations) {
			await ctx.db.delete('allocations', allocation._id);
		}

		await ctx.db.delete('transactions', transaction._id);
		return null;
	}
});
