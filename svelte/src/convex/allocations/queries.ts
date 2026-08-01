import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
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

		return allocations.flatMap((allocation) => {
			const transaction = transactions.get(allocation.transactionId);
			if (!transaction || transaction.type !== 'expenditure') {
				return [];
			}
			return [
				{
					allocationId: allocation._id,
					transactionId: allocation.transactionId,
					amountCents: allocation.amountCents,
					budgetItem: normalizeBudgetItem(allocation.budgetItem),
					occurredOn: transaction.occurredOn ?? null,
					method: transaction.method ?? null,
					reference: transaction.reference ?? null
				}
			];
		});
	}
});
