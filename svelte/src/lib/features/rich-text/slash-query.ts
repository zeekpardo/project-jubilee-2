// ============================================================
// Slash-menu matching — when `/` means "insert a block"
// ============================================================
// Split out of the editor component so the two decisions that are easy to get
// wrong can be read and tested without a browser: WHEN the menu opens, and
// WHICH entries survive what the author has typed since the slash.
//
// It knows nothing about Milkdown, ProseMirror, Svelte or i18n. It takes the
// text to the left of the caret and a list of labelled things, and returns
// strings and booleans.
// ============================================================

/**
 * The slash and everything typed after it, or null when the caret is not in a
 * slash context.
 *
 * The slash must start a word — it is preceded by the start of the block or by
 * whitespace. Without that rule the menu would open inside every URL an author
 * pastes and after every closing bracket, which is the behaviour that makes
 * people stop typing `/` altogether.
 *
 * The query stops at whitespace, so pressing space after `/` closes the menu and
 * leaves an ordinary slash in the prose. That is the escape hatch for anyone who
 * genuinely wanted the character.
 */
const SLASH_QUERY = /(?:^|\s)\/([^\s/]*)$/;

export function matchSlashQuery(textBeforeCaret: string): string | null {
	const match = SLASH_QUERY.exec(textBeforeCaret);
	return match ? (match[1] ?? '') : null;
}

/** The shape this module needs from a menu entry, and nothing more. */
export interface SlashSearchable {
	label: string;
	/** Extra words that should find this entry — synonyms, the markdown syntax. */
	keywords?: string[];
}

/**
 * Entries matching the query, in their original order.
 *
 * Matching is a case-insensitive substring test rather than a fuzzy score. A
 * fuzzy match reorders the list as the author types, so the entry under the
 * cursor changes between deciding to press Enter and pressing it; a stable order
 * means muscle memory works.
 */
export function filterSlashItems<T extends SlashSearchable>(
	items: readonly T[],
	query: string
): T[] {
	const needle = query.trim().toLowerCase();
	if (needle === '') return [...items];

	return items.filter((item) =>
		[item.label, ...(item.keywords ?? [])].some((term) => term.toLowerCase().includes(needle))
	);
}
