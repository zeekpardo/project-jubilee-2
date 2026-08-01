// The Documents tab shows two things that are not the same kind of thing: rows
// of the `documents` table, which a user added here and can edit or delete, and
// receipts that arrived through the money ledger, which belong to their
// transaction and are read-only here. Merging them is a display concern — the
// two sources never mix in storage — so it lives in this pure module and is
// tested without a database.

/** The parts of a `documents` row that decide where it sorts. */
export type DocumentSortable = {
	_id: string;
	_creationTime: number;
	occurredOn?: string;
};

/** The parts of a ledger receipt row that decide where it sorts. */
export type LedgerReceiptSortable = {
	transactionId: string;
	createdAt: number;
	occurredOn: string | null;
};

/**
 * One row of the merged table. `source` is what the view branches on: it
 * decides the origin badge and whether edit/delete controls exist at all.
 */
export type ProjectDocumentTableRow<D, R> =
	| { source: 'document'; key: string; document: D }
	| { source: 'ledger'; key: string; receipt: R };

type Ranked = { occurredOn: string | null; createdAt: number };

/**
 * Newest first, by the date the document or receipt says it happened on.
 *
 * Dates are ISO 'YYYY-MM-DD' strings, so comparing them as text is comparing
 * them as dates. Undated rows sort last rather than first: a missing date is
 * unknown, not recent, and floating unknowns to the top would push the newest
 * real evidence out of view.
 *
 * Creation time breaks ties so the order is total — same-day rows, and the
 * undated tail, do not shuffle between reads.
 */
function compareRows(a: Ranked, b: Ranked): number {
	if (a.occurredOn !== b.occurredOn) {
		if (!a.occurredOn) return 1;
		if (!b.occurredOn) return -1;
		return b.occurredOn.localeCompare(a.occurredOn);
	}
	return b.createdAt - a.createdAt;
}

/**
 * The Documents tab's single list: stored documents and ledger receipts
 * interleaved by date, newest first.
 *
 * They interleave rather than sitting in two blocks because the question the
 * tab answers is "what evidence does this project have", and evidence recorded
 * on the same day belongs together whichever screen produced it. The `source`
 * tag, not the position, is what tells the two apart.
 */
export function mergeProjectDocumentRows<
	D extends DocumentSortable,
	R extends LedgerReceiptSortable
>(documents: readonly D[], receipts: readonly R[]): ProjectDocumentTableRow<D, R>[] {
	const rows: (ProjectDocumentTableRow<D, R> & Ranked)[] = [
		...documents.map((document) => ({
			source: 'document' as const,
			key: document._id,
			document,
			occurredOn: document.occurredOn ?? null,
			createdAt: document._creationTime
		})),
		...receipts.map((receipt) => ({
			source: 'ledger' as const,
			key: receipt.transactionId,
			receipt,
			occurredOn: receipt.occurredOn,
			createdAt: receipt.createdAt
		}))
	];

	return rows.sort(compareRows);
}
