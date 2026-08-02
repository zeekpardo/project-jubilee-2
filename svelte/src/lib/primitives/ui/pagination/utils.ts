// ============================================================
// Pagination maths — pure, so the control and its owner agree
// ============================================================
// The component renders what these return, and the OWNER — which holds the URL,
// the rows and whatever selection sits on them — slices its own list with the
// same functions. Two implementations of "which page is this" is exactly how a
// pager ends up offering page 3 of 2, so there is only one.
//
// Nothing here imports Svelte. It is arithmetic over three numbers and it is
// unit-tested as such.
// ============================================================

/**
 * How many pages `total` rows fill, `size` at a time.
 *
 * NEVER zero: an empty list is page one of one, not page one of none — a caller
 * that wants to hide the control asks about `total`, not about this. A junk or
 * zero `size` falls back to a single page rather than dividing by nothing.
 */
export function countPages(total: number, size: number): number {
	if (!Number.isFinite(total) || total <= 0) return 1;
	if (!Number.isFinite(size) || size <= 0) return 1;
	return Math.max(1, Math.ceil(total / size));
}

/**
 * The page actually shown for a requested one.
 *
 * A page number arrives from a URL — pasted into chat, hand-edited, or simply
 * older than the data behind it — so it is CLAMPED rather than trusted. "Page
 * 40 of 3" has a readable answer, which is the last page; an empty table under
 * a full-looking list is not one.
 */
export function clampPage(page: number, pageCount: number): number {
	if (!Number.isFinite(page)) return 1;
	return Math.min(Math.max(Math.trunc(page), 1), Math.max(1, pageCount));
}

/**
 * The 1-based, inclusive row numbers this page covers — the "26–50 of 400" the
 * summary reads out.
 *
 * An empty list is 0–0 of 0 rather than 1–0: a summary must not name a first row
 * that is not there.
 */
export function pageRange(
	page: number,
	size: number,
	total: number
): { start: number; end: number } {
	if (total <= 0 || size <= 0) return { start: 0, end: 0 };
	const start = (clampPage(page, countPages(total, size)) - 1) * size + 1;
	return { start, end: Math.min(start + size - 1, total) };
}

/** A page number to offer, or a gap standing in for the pages between two of them. */
export type PaginationItem = number | 'gap';

/**
 * Which page numbers to put on screen: the first, the last, and `siblings`
 * either side of the current page, with gaps for whatever is skipped.
 *
 * A gap is only drawn where it hides MORE THAN ONE page. Replacing a single
 * hidden page with an ellipsis costs the reader a click and saves no room, so
 * that page is drawn instead — which is also why the returned length varies by
 * one and callers must not assume a fixed number of buttons.
 */
export function paginationItems(
	page: number,
	pageCount: number,
	siblings: number = 1
): PaginationItem[] {
	const last = Math.max(1, Math.trunc(pageCount));
	const current = clampPage(page, last);
	const reach = Math.max(0, Math.trunc(siblings));

	// A gapped row is at most: first, gap, three siblings, gap, last. Below that
	// many pages the gaps save no width at all, so every page is drawn — the row
	// is the same size either way and one of the two versions costs a click.
	if (last <= 2 * reach + 5) {
		return Array.from({ length: last }, (_unused, index) => index + 1);
	}

	// A set, because the first page, the last page and the sibling window overlap
	// near either end — and the overlap is the common case, not the edge one.
	const wanted = new Set<number>([1, last]);
	for (let candidate = current - reach; candidate <= current + reach; candidate++) {
		if (candidate >= 1 && candidate <= last) wanted.add(candidate);
	}

	const items: PaginationItem[] = [];
	let previous = 0;
	for (const number of [...wanted].sort((a, b) => a - b)) {
		if (previous) {
			const skipped = number - previous - 1;
			if (skipped === 1) items.push(previous + 1);
			else if (skipped > 1) items.push('gap');
		}
		items.push(number);
		previous = number;
	}
	return items;
}
