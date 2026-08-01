import { describe, expect, it } from 'vitest';
import {
	mergeProjectDocumentRows,
	type DocumentSortable,
	type LedgerReceiptSortable,
	type ProjectDocumentTableRow
} from './document-rows';

type Document = DocumentSortable & { label: string };
type Receipt = LedgerReceiptSortable & { label: string };

const documents: Document[] = [
	{ _id: 'doc-old', _creationTime: 10, occurredOn: '2026-01-05', label: 'doc-old' },
	{ _id: 'doc-new', _creationTime: 20, occurredOn: '2026-03-01', label: 'doc-new' },
	{ _id: 'doc-undated', _creationTime: 30, label: 'doc-undated' }
];

const receipts: Receipt[] = [
	{ transactionId: 'txn-mid', createdAt: 40, occurredOn: '2026-02-01', label: 'txn-mid' },
	{ transactionId: 'txn-undated', createdAt: 50, occurredOn: null, label: 'txn-undated' }
];

function labels(rows: ProjectDocumentTableRow<Document, Receipt>[]): string[] {
	return rows.map((row) => (row.source === 'document' ? row.document.label : row.receipt.label));
}

describe('mergeProjectDocumentRows', () => {
	it('interleaves both sources by date, newest first', () => {
		const rows = mergeProjectDocumentRows(documents, receipts);
		expect(labels(rows).slice(0, 3)).toEqual(['doc-new', 'txn-mid', 'doc-old']);
	});

	it('sorts undated rows last, whichever source they came from', () => {
		const rows = mergeProjectDocumentRows(documents, receipts);
		expect(labels(rows).slice(3)).toEqual(['txn-undated', 'doc-undated']);
	});

	it('tags each row with the source that decides whether it is editable', () => {
		const rows = mergeProjectDocumentRows(documents, receipts);
		expect(rows.filter((row) => row.source === 'ledger')).toHaveLength(2);
		expect(rows.filter((row) => row.source === 'document')).toHaveLength(3);
	});

	it('keys documents by id and ledger receipts by transaction', () => {
		const rows = mergeProjectDocumentRows(documents, receipts);
		expect(rows.map((row) => row.key).sort()).toEqual([
			'doc-new',
			'doc-old',
			'doc-undated',
			'txn-mid',
			'txn-undated'
		]);
	});

	it('breaks same-day ties by creation time, newest first', () => {
		const sameDay: Document[] = [
			{ _id: 'first', _creationTime: 1, occurredOn: '2026-02-01', label: 'first' },
			{ _id: 'second', _creationTime: 2, occurredOn: '2026-02-01', label: 'second' }
		];
		const rows = mergeProjectDocumentRows(sameDay, [
			{ transactionId: 'txn', createdAt: 3, occurredOn: '2026-02-01', label: 'txn' }
		]);
		expect(labels(rows)).toEqual(['txn', 'second', 'first']);
	});

	it('returns the ledger receipts alone when the project has no documents', () => {
		const rows = mergeProjectDocumentRows<Document, Receipt>([], receipts);
		expect(labels(rows)).toEqual(['txn-mid', 'txn-undated']);
	});

	it('is empty only when both sources are', () => {
		expect(mergeProjectDocumentRows<Document, Receipt>([], [])).toEqual([]);
	});
});
