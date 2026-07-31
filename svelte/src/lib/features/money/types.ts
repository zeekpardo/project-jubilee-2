import type { Doc, Id } from '$convex/_generated/dataModel';

export type Transaction = Doc<'transactions'>;
export type Allocation = Doc<'allocations'>;
export type TransactionType = Transaction['type'];

/** A transaction from `listUnallocated`, which appends what is left on it. */
export type UnallocatedTransaction = Transaction & { remainingCents: number };

/** Only what the donor picker and the ledger's donor column read. */
export type DonorOption = {
	_id: Id<'contacts'>;
	firstName: string;
	lastName?: string;
};

/** Only what the project picker reads. */
export type ProjectOption = {
	_id: Id<'projects'>;
	name: string;
};
