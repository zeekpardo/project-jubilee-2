import { describe, expect, it } from 'vitest';
import { slugifyTitle, uniqueSlug } from './update-slug';

describe('slugifyTitle', () => {
	it('lowercases and joins words with single hyphens', () => {
		expect(slugifyTitle('The Family Came Home')).toBe('the-family-came-home');
	});

	it('collapses runs of punctuation and whitespace into one separator', () => {
		expect(slugifyTitle('Freed!!!  At   last... finally')).toBe('freed-at-last-finally');
	});

	it('leaves no hyphen at either end, whatever the title started or ended with', () => {
		expect(slugifyTitle('  "Home." ')).toBe('home');
		expect(slugifyTitle('---rescued---')).toBe('rescued');
	});

	it('folds accented latin to its ascii base rather than dropping the letter', () => {
		expect(slugifyTitle('Café reunion in Bogotá')).toBe('cafe-reunion-in-bogota');
	});

	it('keeps digits, because a title often carries a year or a count', () => {
		expect(slugifyTitle('12 families freed in 2026')).toBe('12-families-freed-in-2026');
	});

	// The case this app will actually hit: staff write in Urdu, which is Arabic
	// script and has no ascii fold, so the whole title strips away. An empty slug
	// would be a URL that resolves to the index instead of the post, so the
	// fallback is a real word the collision-breaker can then number.
	it('yields a usable fallback rather than an empty string for a title it cannot transliterate', () => {
		expect(slugifyTitle('خاندان گھر واپس آ گیا')).toBe('update');
		expect(slugifyTitle('家族が帰ってきた')).toBe('update');
		expect(slugifyTitle('!!! ??? ...')).toBe('update');
		expect(slugifyTitle('')).toBe('update');
		expect(slugifyTitle('   ')).toBe('update');
	});

	it('caps the length at a word boundary so a long title does not become a long url', () => {
		const slug = slugifyTitle(
			'The family we first met at the brick kiln outside Lahore has come home after eleven long years of bonded labour'
		);
		expect(slug.length).toBeLessThanOrEqual(80);
		expect(slug).toBe(
			'the-family-we-first-met-at-the-brick-kiln-outside-lahore-has-come-home-after'
		);
	});

	it('cuts a single over-long word short, since there is no boundary to cut at', () => {
		const slug = slugifyTitle('a'.repeat(200));
		expect(slug).toBe('a'.repeat(80));
	});
});

describe('uniqueSlug', () => {
	it('returns the base untouched when nothing has claimed it', () => {
		expect(uniqueSlug('the-family-came-home', new Set())).toBe('the-family-came-home');
		expect(uniqueSlug('the-family-came-home', new Set(['a-different-post']))).toBe(
			'the-family-came-home'
		);
	});

	it('numbers from 2, because the first post of that title carries no number', () => {
		expect(uniqueSlug('a-visit', new Set(['a-visit']))).toBe('a-visit-2');
	});

	it('keeps counting past every taken suffix rather than stopping at the first gap it saw', () => {
		const taken = new Set(['a-visit', 'a-visit-2', 'a-visit-3']);
		expect(uniqueSlug('a-visit', taken)).toBe('a-visit-4');
	});

	// Every Urdu-titled post in one scope slugifies to the same fallback, so this
	// is the path that gives each of them a distinct permalink.
	it('disambiguates repeated fallbacks the same way as any other collision', () => {
		expect(uniqueSlug('update', new Set(['update']))).toBe('update-2');
		expect(uniqueSlug('update', new Set(['update', 'update-2']))).toBe('update-3');
	});

	it('substitutes the fallback for an empty base rather than minting an empty slug', () => {
		expect(uniqueSlug('', new Set())).toBe('update');
		expect(uniqueSlug('', new Set(['update']))).toBe('update-2');
	});
});
