import { describe, expect, it } from 'vitest';
import { escalationExcerpt, normalizeForScan, scanForEscalation } from './checkin-escalation';

// This scanner is the only thing standing between a family's disclosure and an
// automated question about school. It is deliberately high-recall, so these
// tests are split in two: the things it MUST catch, where a miss is the
// failure the whole design exists to prevent, and the things it must not catch,
// which are the ones that make staff stop reading the queue.

describe('scanForEscalation — must catch', () => {
	it('catches a violence disclosure', () => {
		const scan = scanForEscalation('please help, he hit me again last night');
		expect(scan.escalated).toBe(true);
		expect(scan.matches[0].category).toBe('violence');
	});

	it('catches self-harm', () => {
		expect(scanForEscalation('sometimes I just want to die').escalated).toBe(true);
		expect(scanForEscalation('a veces quiero morir').escalated).toBe(true);
	});

	it('catches the disclosure this platform exists for', () => {
		// A family being pulled back into bonded labour. If anything in this file
		// must never regress, it is this one.
		const scan = scanForEscalation('the owner came to the house asking about the loan');
		expect(scan.escalated).toBe(true);
		expect(scan.matches.map((m) => m.category)).toContain('trafficking');
	});

	it('catches Spanish written without accents, as people type on a phone', () => {
		expect(scanForEscalation('me pego otra vez').escalated).toBe(true);
		expect(scanForEscalation('me pegó otra vez').escalated).toBe(true);
	});

	it('is not defeated by punctuation, case or spacing', () => {
		expect(scanForEscalation('HE  HIT   ME!!!').escalated).toBe(true);
		expect(scanForEscalation('...he hit me,').escalated).toBe(true);
	});

	it('reports every category, because two disclosures are two phone calls', () => {
		const scan = scanForEscalation('they beat me and now I want to die');
		const categories = scan.matches.map((match) => match.category);
		expect(categories).toContain('violence');
		expect(categories).toContain('self_harm');
	});
});

describe('scanForEscalation — must not catch', () => {
	it('lets an ordinary good-news reply through', () => {
		const scan = scanForEscalation(
			'We are well thank you. My husband found work at the market and the girls are back in school.'
		);
		expect(scan.escalated).toBe(false);
	});

	it('does not match a phrase inside a longer word', () => {
		// The padded-substring trick is what buys this. Without it, `has a gun`
		// and its neighbours match inside ordinary words and the queue fills with
		// noise nobody reads.
		expect(scanForEscalation('the shipment has begun arriving').escalated).toBe(false);
		expect(scanForEscalation('we discussed a rapid plan').escalated).toBe(false);
	});

	it('lets a hard but non-crisis answer through', () => {
		const scan = scanForEscalation(
			'Money is tight this month and the work has been slow, but we are managing.'
		);
		expect(scan.escalated).toBe(false);
	});
});

describe('normalizeForScan', () => {
	it('pads, so every phrase test is a word-boundary test', () => {
		expect(normalizeForScan('Hola!')).toBe(' hola ');
	});

	it('strips diacritics rather than treating them as different letters', () => {
		expect(normalizeForScan('pegó')).toBe(' pego ');
	});
});

describe('escalationExcerpt', () => {
	it('quotes around the match rather than dumping the message', () => {
		const message = `${'a lot of preamble. '.repeat(20)}he hit me${' and then more. '.repeat(20)}`;
		const scan = scanForEscalation(message);
		const excerpt = escalationExcerpt(message, scan.matches[0]);
		expect(excerpt.length).toBeLessThan(message.length);
		expect(excerpt.length).toBeGreaterThan(0);
	});
});
