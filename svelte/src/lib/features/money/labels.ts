import * as m from '$lib/i18n/messages';
import type { TransactionType } from './types';

export function transactionTypeLabel(type: TransactionType): string {
	if (type === 'donation') return m.money_donations();
	if (type === 'transfer') return m.money_transfers();
	return m.money_expenditures();
}

export function newTransactionTitle(type: TransactionType): string {
	if (type === 'donation') return m.money_newDonation();
	if (type === 'transfer') return m.money_newTransfer();
	return m.money_newExpenditure();
}
