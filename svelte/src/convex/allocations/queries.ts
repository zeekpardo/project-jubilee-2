import { v } from 'convex/values';
import { query, type QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { activeOrgId } from '../model/auth';
import { toAllocationLike, toTransactionLike } from '../model/money';
import { raisedForProject } from '../../lib/domain/reconciliation';
import { normalizeBudgetItem } from '../../lib/domain/budget-actuals';

export const listAllocationsForTransaction = query({
	args: {
		transactionId: v.id('transactions')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return [];
		}

		const transaction = await ctx.db.get('transactions', args.transactionId);
		if (!transaction || transaction.orgId !== orgId) {
			return [];
		}

		return await ctx.db
			.query('allocations')
			.withIndex('by_transactionId', (q) => q.eq('transactionId', args.transactionId))
			.collect();
	}
});

export const listAllocationsForProject = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return [];
		}

		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== orgId) {
			return [];
		}

		return await ctx.db
			.query('allocations')
			.withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
			.collect();
	}
});

export const getRaisedForProject = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return 0;
		}

		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== orgId) {
			return 0;
		}

		const allocations = await ctx.db
			.query('allocations')
			.withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
			.collect();

		const transactions = new Map<string, Doc<'transactions'>>();
		for (const allocation of allocations) {
			if (transactions.has(allocation.transactionId)) {
				continue;
			}
			const transaction = await ctx.db.get('transactions', allocation.transactionId);
			if (transaction && transaction.orgId === orgId) {
				transactions.set(allocation.transactionId, transaction);
			}
		}

		return raisedForProject(
			args.projectId,
			[...transactions.values()].map(toTransactionLike),
			allocations.map(toAllocationLike)
		);
	}
});

/**
 * Actual spend against a project's budget: every EXPENDITURE allocation into
 * this project's fund, with its `budgetItem` tag normalized to the domain's
 * `string | null`. Donations are excluded — they are "raised", the donor-side
 * comparison — and so are transfers, which only move money to the field.
 *
 * Each row also carries the receipt as a `receiptUrl`, minted here on every
 * read from the stored `receiptStorageId` and never persisted. The database
 * holds a pointer, not a link: the URL is short-lived, so a copied one dies
 * on its own, and revoking access is a matter of not answering the next read.
 * Org scoping is the gate — the same one that already governs seeing the
 * expenditure amounts these receipts are proof of.
 */
export const getExpendituresForProject = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return [];
		}

		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== orgId) {
			return [];
		}

		const allocations = await ctx.db
			.query('allocations')
			.withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
			.collect();

		const transactions = new Map<string, Doc<'transactions'>>();
		for (const allocation of allocations) {
			if (transactions.has(allocation.transactionId)) {
				continue;
			}
			const transaction = await ctx.db.get('transactions', allocation.transactionId);
			if (transaction && transaction.orgId === orgId) {
				transactions.set(allocation.transactionId, transaction);
			}
		}

		// One signed URL per transaction, not per allocation: a split
		// expenditure would otherwise mint the same receipt link several times.
		const receiptUrls = new Map<string, string | null>();
		for (const transaction of transactions.values()) {
			if (transaction.type !== 'expenditure' || !transaction.receiptStorageId) {
				continue;
			}
			receiptUrls.set(transaction._id, await resolveReceiptUrl(ctx, transaction.receiptStorageId));
		}

		const rows = [];
		for (const allocation of allocations) {
			const transaction = transactions.get(allocation.transactionId);
			if (!transaction || transaction.type !== 'expenditure') {
				continue;
			}
			rows.push({
				allocationId: allocation._id,
				transactionId: allocation.transactionId,
				amountCents: allocation.amountCents,
				budgetItem: normalizeBudgetItem(allocation.budgetItem),
				occurredOn: transaction.occurredOn ?? null,
				method: transaction.method ?? null,
				reference: transaction.reference ?? null,
				receiptUrl: receiptUrls.get(allocation.transactionId) ?? null
			});
		}
		return rows;
	}
});

/**
 * A receipt blob as a link the browser can open, or null. A receipt that has
 * been deleted out from under its transaction is a missing proof, not a broken
 * page, so a failure to resolve degrades to "no receipt" rather than throwing
 * and taking the whole budget ledger down with it.
 */
async function resolveReceiptUrl(ctx: QueryCtx, storageId: Id<'_storage'>): Promise<string | null> {
	try {
		return await ctx.storage.getUrl(storageId);
	} catch {
		return null;
	}
}
