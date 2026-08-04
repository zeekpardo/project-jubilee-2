import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { internalQuery, query } from '../_generated/server';
import { readableOrgId } from '../model/access';
import { transactionTypeValidator } from '../model/money';
import type { ReconciliationResult } from '../../lib/domain/reconciliation';

/**
 * One page of transactions, newest first.
 *
 * Paginated rather than returning everything, and `type` is a real filter
 * rather than something the caller strips out afterwards. The budget page used
 * to load the org's entire ledger and filter it in the browser for each tab,
 * which is fine at a few hundred rows and stops working entirely at the tens
 * of thousands a few years of online giving produces — Convex mutations and
 * queries have hard limits on documents read, so that path does not degrade,
 * it fails.
 *
 * `limit` is kept for the callers that genuinely want a small fixed slice
 * (dashboards, recent-activity strips) and is capped, so it cannot become a
 * way to ask for everything again.
 */
export const listTransactions = query({
	args: {
		type: v.optional(transactionTypeValidator),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'money:read');
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

		return await rows.order('desc').take(Math.min(args.limit ?? 100, 200));
	}
});

/** The paginated form, for the budget ledger's own tabs. */
export const pageTransactions = query({
	args: {
		paginationOpts: paginationOptsValidator,
		type: v.optional(transactionTypeValidator)
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'money:read');
		if (!orgId) {
			return { page: [], isDone: true, continueCursor: '' };
		}

		const type = args.type;
		const rows =
			type === undefined
				? ctx.db.query('transactions').withIndex('by_orgId', (q) => q.eq('orgId', orgId))
				: ctx.db
						.query('transactions')
						.withIndex('by_orgId_and_type', (q) => q.eq('orgId', orgId).eq('type', type));

		return await rows.order('desc').paginate(args.paginationOpts);
	}
});

export const getTransaction = query({
	args: {
		transactionId: v.id('transactions')
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'money:read');
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

const EMPTY_RECONCILIATION: ReconciliationResult = {
	receivedCents: 0,
	sentCents: 0,
	spentCents: 0,
	usBalanceCents: 0,
	pkBalanceCents: 0,
	unallocatedByType: { donation: 0, transfer: 0, expenditure: 0 }
};

/**
 * The ledger's headline numbers, in one indexed read.
 *
 * This used to load every transaction AND every allocation in the org on each
 * subscription tick, just to add up five figures — a scan whose cost grows
 * with everything the organization has ever done. Online giving is about to
 * make donations the highest-volume row type in the system, and Convex caps
 * documents read per query, so that path does not degrade gracefully: it
 * eventually fails outright.
 *
 * The totals are maintained on write by the trigger in `functions.ts`, so this
 * reads one row. The two balances stay derived rather than stored, because
 * they are pure subtraction and a stored copy is one more thing that can
 * disagree with its own inputs.
 *
 * A missing row means an org that has never recorded any money — a real state,
 * not an error, and not something to backfill from a read.
 */
export const getReconciliation = query({
	args: {},
	handler: async (ctx): Promise<ReconciliationResult> => {
		const orgId = await readableOrgId(ctx, 'money:read');
		if (!orgId) return EMPTY_RECONCILIATION;

		const totals = await ctx.db
			.query('orgMoneyTotals')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.unique();
		if (!totals) return EMPTY_RECONCILIATION;

		return {
			receivedCents: totals.receivedCents,
			sentCents: totals.sentCents,
			spentCents: totals.spentCents,
			usBalanceCents: totals.receivedCents - totals.sentCents,
			pkBalanceCents: totals.sentCents - totals.spentCents,
			unallocatedByType: {
				donation: totals.unallocatedDonationCents,
				transfer: totals.unallocatedTransferCents,
				expenditure: totals.unallocatedExpenditureCents
			}
		};
	}
});

/**
 * The allocation inbox: money recorded but not yet attributed.
 *
 * Reached through `by_orgId_and_isFullyAllocated` rather than by reading the
 * whole ledger and subtracting it from itself. The flag is maintained by the
 * allocations trigger, so it cannot disagree with the rows it summarizes.
 *
 * The index range is `isFullyAllocated: false`, deliberately not "anything
 * other than true". A row written before the backfill has the field unset, and
 * an unattributed transaction belongs IN this inbox rather than silently
 * outside it — so the migration sets the flag explicitly on every existing row
 * instead of leaning on a default here.
 */
export const listUnallocated = query({
	args: {
		type: v.optional(transactionTypeValidator),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'money:read');
		if (!orgId) return [];

		const rows = await ctx.db
			.query('transactions')
			.withIndex('by_orgId_and_isFullyAllocated', (q) =>
				q.eq('orgId', orgId).eq('isFullyAllocated', false)
			)
			.order('desc')
			.take(Math.min(args.limit ?? 100, 200));

		return rows
			.filter((transaction) => args.type === undefined || transaction.type === args.type)
			.map((transaction) => ({
				...transaction,
				remainingCents: transaction.amountCents - (transaction.allocatedCents ?? 0)
			}));
	}
});

/**
 * Recomputes the ledger totals from scratch and reports any drift.
 *
 * The denormalized totals in `orgMoneyTotals` are maintained by a trigger, and
 * a trigger is only as good as its coverage: a mutation defined with the raw
 * builder from `_generated/server` instead of the wrapped one in
 * `functions.ts` would write money without firing it, and the total would be
 * quietly wrong forever with nothing to notice.
 *
 * So this exists as the thing that notices. It deliberately does the expensive
 * scan the budget page no longer does — that is the point of an audit — which
 * is why it is internal and unbounded rather than something a page subscribes
 * to. Run it by hand after touching ledger code, or from a cron if drift ever
 * turns out to be real:
 *
 *   npx convex run transactions/queries:auditLedgerTotals '{"orgId":"..."}'
 *
 * A non-empty `drift` means run `migrations:resetLedgerTotals` followed by
 * `migrations:backfillLedgerTotals`.
 */
export const auditLedgerTotals = internalQuery({
	args: { orgId: v.string() },
	handler: async (ctx, args) => {
		const transactions = await ctx.db
			.query('transactions')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.take(20_000);

		const computed = {
			receivedCents: 0,
			sentCents: 0,
			spentCents: 0,
			unallocatedDonationCents: 0,
			unallocatedTransferCents: 0,
			unallocatedExpenditureCents: 0
		};

		// Recomputed from the ALLOCATIONS rather than from the denormalized
		// `allocatedCents`, so this checks that field too rather than trusting
		// the very thing it is auditing.
		for (const transaction of transactions) {
			const allocations = await ctx.db
				.query('allocations')
				.withIndex('by_transactionId', (q) => q.eq('transactionId', transaction._id))
				.take(200);
			const allocated = allocations.reduce((sum, row) => sum + row.amountCents, 0);
			const unallocated = Math.max(0, transaction.amountCents - allocated);

			if (transaction.type === 'donation') {
				computed.receivedCents += transaction.amountCents;
				computed.unallocatedDonationCents += unallocated;
			} else if (transaction.type === 'transfer') {
				computed.sentCents += transaction.amountCents;
				computed.unallocatedTransferCents += unallocated;
			} else {
				computed.spentCents += transaction.amountCents;
				computed.unallocatedExpenditureCents += unallocated;
			}
		}

		const stored = await ctx.db
			.query('orgMoneyTotals')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.unique();

		const drift: Record<string, { stored: number; computed: number }> = {};
		for (const [key, value] of Object.entries(computed)) {
			const storedValue = stored ? (stored as unknown as Record<string, number>)[key] : 0;
			if (storedValue !== value) drift[key] = { stored: storedValue, computed: value };
		}

		return { transactionsScanned: transactions.length, computed, drift };
	}
});
