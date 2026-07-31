import { allocationRemainder } from '$lib/domain/reconciliation';
import type { Allocation, Transaction } from './types';

/**
 * Unattributed cents left on a transaction, via the domain math.
 *
 * `allocationRemainder` throws when the stored rows already exceed the
 * transaction — a server-side invariant the client cannot repair. A ledger
 * screen still has to render, so a breach reads as nothing left to attribute
 * rather than a blank page.
 */
export function remainingCents(transaction: Transaction, allocations: Allocation[]): number {
	try {
		return allocationRemainder(
			{
				id: transaction._id,
				type: transaction.type,
				amountCents: transaction.amountCents
			},
			allocations.map((allocation) => ({
				transactionId: allocation.transactionId,
				projectId: allocation.projectId ?? null,
				amountCents: allocation.amountCents
			}))
		);
	} catch {
		return 0;
	}
}
