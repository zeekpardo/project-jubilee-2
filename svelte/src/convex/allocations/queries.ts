import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { activeOrgId } from '../model/auth';
import { toAllocationLike, toTransactionLike } from '../model/money';
import { raisedForProject } from '../../lib/domain/reconciliation';

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
