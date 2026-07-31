/**
 * Money is integer cents everywhere in this app. This is the only place that
 * turns it into something a person reads, so a component never does the
 * division itself and cannot drift from the ledger.
 */
export function formatCents(cents: number, currency = 'USD'): string {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency,
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	}).format(cents / 100);
}

/** Compact form for stat tiles, e.g. $287,350 with no cents. */
export function formatCentsCompact(cents: number, currency = 'USD'): string {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency,
		minimumFractionDigits: 0,
		maximumFractionDigits: 0
	}).format(cents / 100);
}
