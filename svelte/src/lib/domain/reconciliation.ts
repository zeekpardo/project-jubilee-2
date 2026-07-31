// Pure reconciliation math — no db imports. Mirrors the sheet header math:
// usBalance = received − sent; pkBalance = sent − spent.

export type TransactionType = 'donation' | 'transfer' | 'expenditure';

export interface TransactionLike {
	id: string;
	type: TransactionType;
	amountCents: number;
}

export interface AllocationLike {
	transactionId: string;
	/**
	 * The project this allocation is attributed to, or null for a
	 * campaign-level (project-less) allocation. Replaces the retired `fundId`.
	 * Unused by the reconciliation totals (which read amounts only); used by
	 * raisedForProject.
	 */
	projectId?: string | null;
	amountCents: number;
}

export interface ReconciliationResult {
	receivedCents: number;
	sentCents: number;
	spentCents: number;
	usBalanceCents: number;
	pkBalanceCents: number;
	unallocatedByType: Record<TransactionType, number>;
}

/**
 * Remaining unallocated cents for a single transaction.
 * Throws on over-allocation — the invariant is
 * sum(allocations) ≤ transaction.amountCents.
 */
export function allocationRemainder(
	transaction: TransactionLike,
	allocations: AllocationLike[]
): number {
	const allocated = allocations
		.filter((a) => a.transactionId === transaction.id)
		.reduce((sum, a) => sum + a.amountCents, 0);
	if (allocated > transaction.amountCents) {
		throw new Error(
			`Over-allocated transaction ${transaction.id}: ${allocated} > ${transaction.amountCents}`
		);
	}
	return transaction.amountCents - allocated;
}

/**
 * Ledger totals across all transactions plus the unallocated remainder per
 * type (the allocation inbox counts).
 */
export function reconciliation(
	transactions: TransactionLike[],
	allocations: AllocationLike[]
): ReconciliationResult {
	const totals: Record<TransactionType, number> = {
		donation: 0,
		transfer: 0,
		expenditure: 0
	};
	const unallocatedByType: Record<TransactionType, number> = {
		donation: 0,
		transfer: 0,
		expenditure: 0
	};

	for (const tx of transactions) {
		totals[tx.type] += tx.amountCents;
		unallocatedByType[tx.type] += allocationRemainder(tx, allocations);
	}

	const receivedCents = totals.donation;
	const sentCents = totals.transfer;
	const spentCents = totals.expenditure;

	return {
		receivedCents,
		sentCents,
		spentCents,
		usBalanceCents: receivedCents - sentCents,
		pkBalanceCents: sentCents - spentCents,
		unallocatedByType
	};
}

/**
 * Total raised for a project = sum of donation allocations
 * attributed to that project.
 */
export function raisedForProject(
	projectId: string,
	transactions: TransactionLike[],
	allocations: AllocationLike[]
): number {
	const donationIds = new Set(
		transactions.filter((tx) => tx.type === 'donation').map((tx) => tx.id)
	);
	return allocations
		.filter((a) => a.projectId === projectId && donationIds.has(a.transactionId))
		.reduce((sum, a) => sum + a.amountCents, 0);
}
