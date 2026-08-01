import { ConvexError, v } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { AllocationLike, TransactionLike } from '../../lib/domain/reconciliation';
import { allocationRemainder } from '../../lib/domain/reconciliation';

export const transactionTypeValidator = v.union(
	v.literal('donation'),
	v.literal('transfer'),
	v.literal('expenditure')
);

/** Number.isInteger also rejects NaN and Infinity. */
export function assertCents(label: string, cents: number): void {
	if (!Number.isInteger(cents)) {
		throw new ConvexError(`${label} must be an integer number of cents`);
	}
}

export function assertNonNegativeCents(label: string, cents: number): void {
	assertCents(label, cents);
	if (cents < 0) {
		throw new ConvexError(`${label} must not be negative`);
	}
}

/** A real charge: zero is not an expenditure, so it is rejected too. */
export function assertPositiveCents(label: string, cents: number): void {
	assertCents(label, cents);
	if (cents <= 0) {
		throw new ConvexError(`${label} must be greater than zero`);
	}
}

export function toTransactionLike(transaction: Doc<'transactions'>): TransactionLike {
	return {
		id: transaction._id,
		type: transaction.type,
		amountCents: transaction.amountCents
	};
}

export function toAllocationLike(allocation: Doc<'allocations'>): AllocationLike {
	return {
		transactionId: allocation.transactionId,
		projectId: allocation.projectId ?? null,
		amountCents: allocation.amountCents
	};
}

export async function requireTransaction(
	ctx: QueryCtx,
	orgId: string,
	transactionId: Id<'transactions'>
): Promise<Doc<'transactions'>> {
	const transaction = await ctx.db.get('transactions', transactionId);
	if (!transaction || transaction.orgId !== orgId) {
		throw new ConvexError('Transaction not found');
	}
	return transaction;
}

export async function requireCampaign(
	ctx: QueryCtx,
	orgId: string,
	campaignId: Id<'campaigns'>
): Promise<Doc<'campaigns'>> {
	const campaign = await ctx.db.get('campaigns', campaignId);
	if (!campaign || campaign.orgId !== orgId) {
		throw new ConvexError('Campaign not found');
	}
	return campaign;
}

export async function requireProjectInCampaign(
	ctx: QueryCtx,
	orgId: string,
	projectId: Id<'projects'>,
	campaignId: Id<'campaigns'>
): Promise<Doc<'projects'>> {
	const project = await ctx.db.get('projects', projectId);
	if (!project || project.orgId !== orgId) {
		throw new ConvexError('Project not found');
	}
	if (project.campaignId !== campaignId) {
		throw new ConvexError("Project does not belong to the allocation's campaign");
	}
	return project;
}

export async function requireAllocation(
	ctx: QueryCtx,
	orgId: string,
	allocationId: Id<'allocations'>
): Promise<Doc<'allocations'>> {
	const allocation = await ctx.db.get('allocations', allocationId);
	if (!allocation || allocation.orgId !== orgId) {
		throw new ConvexError('Allocation not found');
	}
	return allocation;
}

export async function allocationsForTransaction(
	ctx: QueryCtx,
	transactionId: Id<'transactions'>
): Promise<Doc<'allocations'>[]> {
	return await ctx.db
		.query('allocations')
		.withIndex('by_transactionId', (q) => q.eq('transactionId', transactionId))
		.collect();
}

/** Unallocated cents left on a stored transaction. */
export function remainderFor(
	transaction: Doc<'transactions'>,
	allocations: Doc<'allocations'>[]
): number {
	return allocationRemainder(toTransactionLike(transaction), allocations.map(toAllocationLike));
}

/**
 * The over-allocation guard: sum(allocations) must never exceed the
 * transaction's amount. `allocationRemainder` throws when it would, so the
 * candidate amount is appended to the existing set and re-checked.
 * On update, `excludeAllocationId` drops the row being edited from the
 * existing set so its old amount is not counted alongside its new one.
 */
export async function assertAllocatable(
	ctx: QueryCtx,
	transactionId: Id<'transactions'>,
	amountCents: number,
	opts: { orgId: string; excludeAllocationId?: Id<'allocations'> }
): Promise<Doc<'transactions'>> {
	const transaction = await requireTransaction(ctx, opts.orgId, transactionId);
	const existing = (await allocationsForTransaction(ctx, transactionId)).filter(
		(allocation) => allocation._id !== opts.excludeAllocationId
	);

	const transactionLike = toTransactionLike(transaction);
	const existingLikes = existing.map(toAllocationLike);
	const remaining = allocationRemainder(transactionLike, existingLikes);

	try {
		allocationRemainder(transactionLike, [
			...existingLikes,
			{ transactionId, projectId: null, amountCents }
		]);
	} catch {
		throw new ConvexError(
			`Allocation of ${amountCents} cents exceeds the ${remaining} cents remaining on this transaction`
		);
	}

	return transaction;
}

/**
 * Guards a transaction amount change: the new amount must still cover every
 * allocation already attributed to it.
 */
export async function assertAmountCoversAllocations(
	ctx: MutationCtx,
	transaction: Doc<'transactions'>,
	nextAmountCents: number
): Promise<void> {
	const existing = await allocationsForTransaction(ctx, transaction._id);
	try {
		allocationRemainder(
			{ ...toTransactionLike(transaction), amountCents: nextAmountCents },
			existing.map(toAllocationLike)
		);
	} catch {
		const allocated = transaction.amountCents - remainderFor(transaction, existing);
		throw new ConvexError(
			`Cannot set amount to ${nextAmountCents} cents: ${allocated} cents are already allocated. Reduce the allocations first.`
		);
	}
}

/**
 * unique(transactionId, projectId), but ONLY when projectId is set: multiple
 * project-less (campaign-level) allocations per transaction are allowed.
 */
export async function assertProjectNotAlreadyAllocated(
	ctx: QueryCtx,
	transactionId: Id<'transactions'>,
	projectId: Id<'projects'>,
	excludeAllocationId?: Id<'allocations'>
): Promise<void> {
	const existing = await ctx.db
		.query('allocations')
		.withIndex('by_transactionId_and_projectId', (q) =>
			q.eq('transactionId', transactionId).eq('projectId', projectId)
		)
		.collect();

	if (existing.some((allocation) => allocation._id !== excludeAllocationId)) {
		throw new ConvexError('This transaction is already allocated to that project');
	}
}
