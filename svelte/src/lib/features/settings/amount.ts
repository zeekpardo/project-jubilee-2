/**
 * People type dollars; the ledger stores integer cents. Parsing is done on the
 * string rather than through `Number(x) * 100` so a third decimal place is
 * rejected outright instead of being silently rounded into someone's rate card.
 */
export function dollarsToCents(input: string): number | null {
	const cleaned = input.trim().replace(/[$,\s]/g, '');
	if (cleaned === '') return null;

	const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
	if (!match) return null;

	const sign = match[1] ?? '';
	const whole = match[2] ?? '';
	const fraction = match[3] ?? '';
	if (whole === '' && fraction === '') return null;
	if (fraction.length > 2) return null;

	const cents = Number(whole || '0') * 100 + Number((fraction + '00').slice(0, 2));
	if (!Number.isSafeInteger(cents)) return null;

	return sign === '-' ? -cents : cents;
}

/**
 * Dollars to cents for an amount that has to be a real charge: a recorded
 * expenditure of zero (or of a negative amount) is not spend, it is a typo, so
 * both are rejected at the boundary rather than reaching the ledger.
 */
export function positiveDollarsToCents(input: string): number | null {
	const cents = dollarsToCents(input);
	if (cents === null || cents <= 0) return null;
	return cents;
}

/** The stored cents back in the shape the dollar input expects. */
export function centsToDollarInput(cents: number): string {
	return (cents / 100).toFixed(2);
}

export function sumCents(lineItems: Record<string, number>): number {
	return Object.values(lineItems).reduce((total, amount) => total + amount, 0);
}
