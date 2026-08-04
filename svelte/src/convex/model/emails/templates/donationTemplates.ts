import { renderBaseEmail, styles } from './baseEmail';

/**
 * The IRS-facing half of a donation receipt.
 *
 * Stripe does not produce these and cannot: its receipt is a PAYMENT receipt —
 * merchant, amount, last four, date — and carries none of what a US
 * contemporaneous written acknowledgment under IRC §170(f)(8) requires. That
 * document is the nonprofit's to issue, which under direct charges means it is
 * ours to generate on their behalf.
 *
 * What the statute wants, and what Stripe's receipt lacks entirely:
 *
 *   - the charity's legal name and EIN
 *   - the date and the amount of cash contributed
 *   - either "no goods or services were provided in exchange for this
 *     contribution", or a description and good-faith estimate of anything that
 *     was provided
 *
 * Required in writing for any single gift of $250 or more, and quid-pro-quo
 * disclosure is required over $75. We send for every gift regardless, because
 * deciding per-gift whether the donor needs paperwork is a worse failure mode
 * than sending one email too many.
 *
 * Note the amount shown is what the donor was CHARGED, including any fee they
 * chose to cover. That is the cash they parted with and therefore the figure
 * the acknowledgment must state.
 */
export interface DonationAcknowledgmentProps {
	orgLegalName: string;
	orgEin?: string;
	donorName?: string;
	amountFormatted: string;
	giftDate: string;
	receiptNumber: string;
	campaignName?: string;
	designation?: string;
	/** Overrides the no-goods-or-services statement for orgs where that is untrue. */
	acknowledgmentText?: string;
	brandName?: string;
	brandTagline?: string;
	brandLogoUrl?: string;
}

const NO_GOODS_OR_SERVICES =
	'No goods or services were provided in exchange for this contribution.';

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function renderDonationAcknowledgment({
	orgLegalName,
	orgEin,
	donorName,
	amountFormatted,
	giftDate,
	receiptNumber,
	campaignName,
	designation,
	acknowledgmentText,
	brandName,
	brandTagline,
	brandLogoUrl
}: DonationAcknowledgmentProps): string {
	const greeting = donorName ? `Dear ${escapeHtml(donorName)},` : 'Hello,';
	const rows: Array<[string, string]> = [
		['Receipt number', escapeHtml(receiptNumber)],
		['Date of contribution', escapeHtml(giftDate)],
		['Amount', escapeHtml(amountFormatted)]
	];
	if (campaignName) rows.push(['Campaign', escapeHtml(campaignName)]);
	if (designation) rows.push(['Designation', escapeHtml(designation)]);
	if (orgEin) rows.push(['EIN', escapeHtml(orgEin)]);

	const rowsHtml = rows
		.map(
			([label, value]) => `
			<tr>
				<td style="${styles.text}; margin: 0; padding: 6px 16px 6px 0; color: #898989; white-space: nowrap;">${label}</td>
				<td style="${styles.text}; margin: 0; padding: 6px 0; font-weight: bold;">${value}</td>
			</tr>`
		)
		.join('');

	const content = `
		<h1 style="${styles.h1}">Thank you for your gift</h1>
		<p style="${styles.text}">${greeting}</p>
		<p style="${styles.text}">
			Thank you for your contribution to ${escapeHtml(orgLegalName)}. This letter is your
			receipt; please keep it for your tax records.
		</p>
		<table style="border-collapse: collapse; margin: 24px 0;">${rowsHtml}</table>
		<p style="${styles.text}">
			${escapeHtml(acknowledgmentText ?? NO_GOODS_OR_SERVICES)}
		</p>
		<p style="${styles.footer}">
			${escapeHtml(orgLegalName)}${orgEin ? ` &bull; EIN ${escapeHtml(orgEin)}` : ''}
		</p>
	`;

	return renderBaseEmail({
		children: content,
		previewText: `Your ${amountFormatted} gift to ${orgLegalName}`,
		brandName,
		brandTagline,
		brandLogoUrl
	});
}

/**
 * Retracts an acknowledgment for a gift that was refunded or disputed.
 *
 * Not a courtesy. A donor holding a valid written acknowledgment for money
 * they got back has a deduction they are not entitled to, on a document the
 * nonprofit issued — so the correction has to be as explicit as the original.
 */
export interface DonationVoidProps {
	orgLegalName: string;
	donorName?: string;
	amountFormatted: string;
	receiptNumber: string;
	reason: 'refunded' | 'disputed';
	/**
	 * What the donor actually still gave, formatted. Absent or zero means the
	 * whole gift came back.
	 *
	 * A partial refund makes the original receipt overstate the deduction
	 * rather than invalidate it, and telling someone their receipt is void when
	 * they genuinely donated most of the money would be both alarming and
	 * wrong.
	 */
	remainingFormatted?: string;
	brandName?: string;
	brandTagline?: string;
	brandLogoUrl?: string;
}

export function renderDonationAcknowledgmentVoid({
	orgLegalName,
	donorName,
	amountFormatted,
	receiptNumber,
	reason,
	remainingFormatted,
	brandName,
	brandTagline,
	brandLogoUrl
}: DonationVoidProps): string {
	const greeting = donorName ? `Dear ${escapeHtml(donorName)},` : 'Hello,';
	const explanation =
		reason === 'refunded'
			? 'this contribution has been refunded'
			: 'this contribution was disputed and the funds returned';
	const partial = Boolean(remainingFormatted);

	const heading = partial ? 'Your receipt has been amended' : 'Your receipt has been voided';

	const body = partial
		? `
			<p style="${styles.text}">
				We are writing to let you know that part of ${explanation}. Receipt
				${escapeHtml(receiptNumber)} from ${escapeHtml(orgLegalName)} was issued for
				${escapeHtml(amountFormatted)}; the deductible amount is now
				${escapeHtml(remainingFormatted!)}.
			</p>
			<p style="${styles.text}">
				Please claim ${escapeHtml(remainingFormatted!)} rather than the amount printed on
				that receipt. If you believe this is a mistake, reply to this email and we
				will look into it.
			</p>`
		: `
			<p style="${styles.text}">
				We are writing to let you know that ${explanation}, so receipt
				${escapeHtml(receiptNumber)} for ${escapeHtml(amountFormatted)} from
				${escapeHtml(orgLegalName)} is no longer valid.
			</p>
			<p style="${styles.text}">
				Please disregard that receipt and do not claim this amount as a charitable
				contribution. If you believe this is a mistake, reply to this email and we
				will look into it.
			</p>`;

	const content = `
		<h1 style="${styles.h1}">${heading}</h1>
		<p style="${styles.text}">${greeting}</p>
		${body}
	`;

	return renderBaseEmail({
		children: content,
		previewText: partial
			? `Receipt ${receiptNumber} has been amended`
			: `Receipt ${receiptNumber} has been voided`,
		brandName,
		brandTagline,
		brandLogoUrl
	});
}
