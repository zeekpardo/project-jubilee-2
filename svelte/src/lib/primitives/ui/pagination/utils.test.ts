import { describe, expect, it } from 'vitest';

import { clampPage, countPages, pageRange, paginationItems } from './utils';

describe('countPages', () => {
	it('rounds up, because a part page is still a page', () => {
		expect(countPages(400, 25)).toBe(16);
		expect(countPages(401, 25)).toBe(17);
		expect(countPages(25, 25)).toBe(1);
	});

	it('is never zero: an empty list is page one of one', () => {
		expect(countPages(0, 25)).toBe(1);
		expect(countPages(-5, 25)).toBe(1);
	});

	it('refuses to divide by a size that is not one', () => {
		expect(countPages(400, 0)).toBe(1);
		expect(countPages(400, Number.NaN)).toBe(1);
	});
});

describe('clampPage', () => {
	it('answers "page 40 of 3" with the last page rather than an empty table', () => {
		expect(clampPage(40, 3)).toBe(3);
	});

	it('floors at one, whatever the URL said', () => {
		expect(clampPage(0, 3)).toBe(1);
		expect(clampPage(-2, 3)).toBe(1);
		expect(clampPage(Number.NaN, 3)).toBe(1);
	});

	it('leaves a page that is in range alone', () => {
		expect(clampPage(2, 3)).toBe(2);
	});
});

describe('pageRange', () => {
	it('reads out the rows this page covers, 1-based and inclusive', () => {
		expect(pageRange(1, 25, 400)).toEqual({ start: 1, end: 25 });
		expect(pageRange(2, 25, 400)).toEqual({ start: 26, end: 50 });
	});

	it('stops the last page at the last row', () => {
		expect(pageRange(3, 25, 60)).toEqual({ start: 51, end: 60 });
	});

	it('names no first row when there are none', () => {
		expect(pageRange(1, 25, 0)).toEqual({ start: 0, end: 0 });
	});
});

describe('paginationItems', () => {
	it('lists every page while they all fit in a gapped row anyway', () => {
		expect(paginationItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
		expect(paginationItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	it('keeps the ends and the current page, gapping the rest', () => {
		expect(paginationItems(8, 20)).toEqual([1, 'gap', 7, 8, 9, 'gap', 20]);
	});

	it('draws a page rather than a gap that would hide exactly one', () => {
		// An ellipsis standing for page 2 alone costs a click and saves no room.
		expect(paginationItems(4, 8)).toEqual([1, 2, 3, 4, 5, 'gap', 8]);
	});

	it('does not repeat a page where the window meets an end', () => {
		expect(paginationItems(1, 20)).toEqual([1, 2, 'gap', 20]);
		expect(paginationItems(20, 20)).toEqual([1, 'gap', 19, 20]);
	});

	it('clamps the current page like everything else does', () => {
		expect(paginationItems(99, 3)).toEqual([1, 2, 3]);
	});

	it('is a single page when there is one', () => {
		expect(paginationItems(1, 1)).toEqual([1]);
		expect(paginationItems(1, 0)).toEqual([1]);
	});
});
