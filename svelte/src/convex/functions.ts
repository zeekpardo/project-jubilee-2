// ============================================================
// Mutation builders that keep the ledger's derived numbers honest
// ============================================================
// `transactions.allocatedCents`, `transactions.isFullyAllocated` and the
// `orgMoneyTotals` row are all DERIVED. The allocations and transactions
// themselves remain the source of truth; these exist so the budget page can
// answer "what did we receive" and "what is unattributed" without reading
// every row in the org to work it out.
//
// The danger with any denormalized total is drift, and this codebase writes
// transactions in fourteen places and allocations in fifteen — across
// mutations, cascade helpers and seeds. Maintaining the totals at each of
// those call sites would be wrong within a month of the next feature.
//
// So they are maintained by TRIGGERS instead. `ctx.db` is wrapped, every
// insert/patch/delete on the two ledger tables fires a hook, and no call site
// has to remember anything. The one rule that makes it work:
//
//   ANY mutation that can reach a transaction or allocation write — directly,
//   through a model helper, or through a cascade — must be defined with the
//   `mutation` / `internalMutation` exported HERE, not from `_generated/server`.
//
// Importing the raw builder is not an error anywhere else; plenty of mutations
// never touch money. It is only these paths that must come through this file.
// ============================================================

import {
	mutation as rawMutation,
	internalMutation as rawInternalMutation
} from './_generated/server';
import type { DataModel } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { Triggers } from 'convex-helpers/server/triggers';
import { customCtx, customMutation } from 'convex-helpers/server/customFunctions';

const triggers = new Triggers<DataModel>();

/**
 * Recomputes one transaction's allocated total from its allocations.
 *
 * Recomputed from the rows rather than adjusted by a delta. A delta is faster
 * and is exactly how these things drift: one missed edge — an allocation
 * moved between transactions, a cascade that clears a projectId, a seed that
 * deletes in bulk — and the number is permanently wrong with nothing to
 * notice it. Reading a transaction's own allocations is bounded by how many
 * ways one transaction was split, which is small by construction.
 */
async function recomputeAllocated(
	ctx: { db: MutationCtx['db'] },
	transactionId: Id<'transactions'>
): Promise<void> {
	const transaction = await ctx.db.get('transactions', transactionId);
	// Already gone: a transaction delete cascades its allocations, and those
	// deletions fire this hook after the parent has been removed.
	if (!transaction) return;

	const allocations = await ctx.db
		.query('allocations')
		.withIndex('by_transactionId', (q) => q.eq('transactionId', transactionId))
		.take(200);

	const allocatedCents = allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
	const isFullyAllocated = allocatedCents >= transaction.amountCents;

	if (
		transaction.allocatedCents === allocatedCents &&
		transaction.isFullyAllocated === isFullyAllocated
	) {
		// No change. Skipping the write matters: patching unconditionally would
		// re-fire the transactions trigger on every allocation touch, and turn
		// one edit into an avoidable write.
		return;
	}

	await ctx.db.patch('transactions', transactionId, { allocatedCents, isFullyAllocated });
}

/**
 * An allocation changed, so its transaction's derived totals are stale.
 *
 * Handles the move case: when an allocation is re-pointed at a different
 * transaction, BOTH the old and new parents need recomputing, which is the
 * kind of thing a delta-based implementation gets wrong.
 */
triggers.register('allocations', async (ctx, change) => {
	const affected = new Set<Id<'transactions'>>();
	if (change.oldDoc) affected.add(change.oldDoc.transactionId);
	if (change.newDoc) affected.add(change.newDoc.transactionId);

	for (const transactionId of affected) {
		await recomputeAllocated(ctx, transactionId);
	}
});

type Totals = {
	receivedCents: number;
	sentCents: number;
	spentCents: number;
	unallocatedDonationCents: number;
	unallocatedTransferCents: number;
	unallocatedExpenditureCents: number;
};

const ZERO: Totals = {
	receivedCents: 0,
	sentCents: 0,
	spentCents: 0,
	unallocatedDonationCents: 0,
	unallocatedTransferCents: 0,
	unallocatedExpenditureCents: 0
};

/** What one transaction contributes to its org's totals. */
function contribution(transaction: Doc<'transactions'>): Totals {
	const amount = transaction.amountCents;
	// Clamped at zero: the ledger's invariant is sum(allocations) <= amount, so
	// a negative remainder should be impossible — but a total that could go
	// negative from one bad row is not a total worth trusting.
	const unallocated = Math.max(0, amount - (transaction.allocatedCents ?? 0));

	switch (transaction.type) {
		case 'donation':
			return { ...ZERO, receivedCents: amount, unallocatedDonationCents: unallocated };
		case 'transfer':
			return { ...ZERO, sentCents: amount, unallocatedTransferCents: unallocated };
		case 'expenditure':
			return { ...ZERO, spentCents: amount, unallocatedExpenditureCents: unallocated };
	}
}

function addTotals(a: Totals, b: Totals, sign: 1 | -1): Totals {
	return {
		receivedCents: a.receivedCents + sign * b.receivedCents,
		sentCents: a.sentCents + sign * b.sentCents,
		spentCents: a.spentCents + sign * b.spentCents,
		unallocatedDonationCents: a.unallocatedDonationCents + sign * b.unallocatedDonationCents,
		unallocatedTransferCents: a.unallocatedTransferCents + sign * b.unallocatedTransferCents,
		unallocatedExpenditureCents:
			a.unallocatedExpenditureCents + sign * b.unallocatedExpenditureCents
	};
}

/**
 * A transaction changed, so its org's totals move by the difference.
 *
 * A delta here rather than a recompute, and this is the one place that trade
 * is right: recomputing would mean reading every transaction in the org, which
 * is precisely the scan this whole mechanism exists to remove. Subtracting the
 * old contribution and adding the new one is exact for every operation —
 * including a type change, where the amount moves between two columns.
 *
 * `orgId` is read off the document rather than a session, because seeds and
 * webhooks write transactions with no caller at all.
 */
triggers.register('transactions', async (ctx, change) => {
	const orgId = change.newDoc?.orgId ?? change.oldDoc?.orgId;
	if (!orgId) return;

	let delta = ZERO;
	if (change.oldDoc) delta = addTotals(delta, contribution(change.oldDoc), -1);
	if (change.newDoc) delta = addTotals(delta, contribution(change.newDoc), 1);

	const unchanged =
		delta.receivedCents === 0 &&
		delta.sentCents === 0 &&
		delta.spentCents === 0 &&
		delta.unallocatedDonationCents === 0 &&
		delta.unallocatedTransferCents === 0 &&
		delta.unallocatedExpenditureCents === 0;
	// Editing a note or attaching a receipt moves no money.
	if (unchanged) return;

	const existing = await ctx.db
		.query('orgMoneyTotals')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.unique();

	if (!existing) {
		await ctx.db.insert('orgMoneyTotals', { orgId, ...addTotals(ZERO, delta, 1) });
		return;
	}

	await ctx.db.patch('orgMoneyTotals', existing._id, addTotals(existing, delta, 1));
});

/**
 * Use these anywhere a transaction or allocation might be written.
 *
 * Drop-in replacements for the builders in `_generated/server` — same
 * signature, same context, with a `db` that fires the triggers above.
 */
export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(rawInternalMutation, customCtx(triggers.wrapDB));

/**
 * The trigger-wrapped writer, for code that already has a raw `MutationCtx`.
 *
 * The migrations component hands its own context to a migration body, so a
 * backfill that writes transactions would otherwise bypass every hook here.
 */
export const withLedgerTriggers = triggers.wrapDB;
