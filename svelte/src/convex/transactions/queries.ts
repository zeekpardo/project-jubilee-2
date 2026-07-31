import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { activeOrgId } from '../model/auth';
import { transactionTypeValidator, remainderFor } from '../model/money';
import { reconciliation } from '../../lib/domain/reconciliation';

async function orgTransactions(ctx: QueryCtx, orgId: string): Promise<Doc<'transactions'>[]> {
	return await ctx.db
		.query('transactions')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.collect();
}

async function orgAllocations(ctx: QueryCtx, orgId: string): Promise<Doc<'allocations'>[]> {
	return await ctx.db
		.query('allocations')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.collect();
}

function groupByTransaction(allocations: Doc<'allocations'>[]): Map<string, Doc<'allocations'>[]> {
	const byTransaction = new Map<string, Doc<'allocations'>[]>();
	for (const allocation of allocations) {
		const group = byTransaction.get(allocation.transactionId);
		if (group) {
			group.push(allocation);
		} else {
			byTransaction.set(allocation.transactionId, [allocation]);
		}
	}
	return byTransaction;
}

export const listTransactions = query({
	args: {
		type: v.optional(transactionTypeValidator),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return [];
		}

		const type = args.type;
		const rows =
			type === undefined
				? ctx.db.query('transactions').withIndex('by_orgId', (q) => q.eq('orgId', orgId))
				: ctx.db
						.query('transactions')
						.withIndex('by_orgId_and_type', (q) => q.eq('orgId', orgId).eq('type', type));

		const ordered = rows.order('desc');
		return args.limit === undefined ? await ordered.collect() : await ordered.take(args.limit);
	}
});

export const getTransaction = query({
	args: {
		transactionId: v.id('transactions')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return null;
		}

		const transaction = await ctx.db.get('transactions', args.transactionId);
		if (!transaction || transaction.orgId !== orgId) {
			return null;
		}

		return transaction;
	}
});

export const getReconciliation = query({
	args: {},
	handler: async (ctx) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return reconciliation([], []);
		}

		const [transactions, allocations] = await Promise.all([
			orgTransactions(ctx, orgId),
			orgAllocations(ctx, orgId)
		]);

		return reconciliation(
			transactions.map((transaction) => ({
				id: transaction._id,
				type: transaction.type,
				amountCents: transaction.amountCents
			})),
			allocations.map((allocation) => ({
				transactionId: allocation.transactionId,
				projectId: allocation.projectId ?? null,
				amountCents: allocation.amountCents
			}))
		);
	}
});

export const listUnallocated = query({
	args: {
		type: v.optional(transactionTypeValidator)
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return [];
		}

		const [transactions, allocations] = await Promise.all([
			orgTransactions(ctx, orgId),
			orgAllocations(ctx, orgId)
		]);
		const byTransaction = groupByTransaction(allocations);

		const unallocated = [];
		for (const transaction of transactions) {
			if (args.type !== undefined && transaction.type !== args.type) {
				continue;
			}
			const remainingCents = remainderFor(transaction, byTransaction.get(transaction._id) ?? []);
			if (remainingCents !== 0) {
				unallocated.push({ ...transaction, remainingCents });
			}
		}

		return unallocated;
	}
});
