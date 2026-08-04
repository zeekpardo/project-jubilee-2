// ============================================================
// The public handle for an update
// ============================================================
// PLAN-updates.md §4c: ids do not travel. A published post has to be
// addressable in a URL a supporter can paste into WhatsApp, and an
// `Id<'updates'>` is not that — it is an internal identifier the privacy wall
// never lets out. So a post is addressed by a slug derived from its title.
//
// The slug is minted at FIRST publish and frozen from then on. Deriving it live
// from the title would mean a later typo fix silently retargets every link
// already shared, and the failure is invisible: the old URL 404s for the reader
// and works for nobody. Freezing it costs a stored column and buys a permalink.
//
// Pure on purpose — no ctx, no clock, no randomness — so the two rules that
// matter (what a title becomes, and how a collision is broken) are testable in
// isolation and produce the same answer in a mutation, a test and a migration.
// ============================================================

/**
 * The longest slug this will derive from a title. A cap exists because a slug
 * ends up in a URL, in a link preview, and in whatever a supporter pastes into a
 * chat window; a 300-character one is unreadable in all three. The disambiguating
 * suffix below may push a few characters past this, which is deliberate — losing
 * the suffix to a length cap would be losing uniqueness to cosmetics.
 */
const MAX_SLUG_LENGTH = 80;

/**
 * What a title yields when it contains nothing this can use.
 *
 * That is not an edge case here. This app serves Pakistani families and staff
 * write in Urdu, which is Arabic script: it has no ASCII fold, so a
 * correctly-spelled Urdu title strips to the empty string. Titles that are
 * entirely punctuation or emoji do the same.
 *
 * The alternatives were worse. Percent-encoding the original script produces a
 * URL that is unreadable and mangled by every chat client that re-encodes it.
 * A random suffix or a timestamp would make this function impure and its output
 * untestable, and a timestamp leaks when a post was written. An id is forbidden
 * outright. A plain word costs nothing and stays honest: `uniqueSlug` already
 * knows how to disambiguate a base that is taken, so the second Urdu post in a
 * campaign is `update-2`, the third `update-3`. Every post still gets a
 * distinct, permanent, copy-pasteable address; only the prettiness is lost, and
 * only for the titles this scheme could never have prettified anyway.
 */
const FALLBACK_SLUG = 'update';

/**
 * A title reduced to the `[a-z0-9-]` alphabet a URL path segment can carry
 * without escaping. Never empty — see FALLBACK_SLUG.
 */
export function slugifyTitle(title: string): string {
	// NFKD splits an accented letter into its base plus a combining mark, and
	// dropping the marks folds 'café' to 'cafe' rather than deleting the whole
	// letter. Scripts with no Latin decomposition are unaffected and fall through
	// to the fallback below.
	const folded = title
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		// Everything else becomes a separator, so runs of punctuation and spaces
		// collapse to a single hyphen instead of surviving as empty segments.
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	return trimToLength(folded) || FALLBACK_SLUG;
}

/**
 * Cut an over-long slug at a word boundary rather than mid-word, so a truncated
 * slug still reads as words. A single word longer than the cap has no boundary
 * to cut at and is simply cut short.
 */
function trimToLength(slug: string): string {
	if (slug.length <= MAX_SLUG_LENGTH) return slug;

	const cut = slug.slice(0, MAX_SLUG_LENGTH);
	const lastBoundary = cut.lastIndexOf('-');
	return (lastBoundary > 0 ? cut.slice(0, lastBoundary) : cut).replace(/-+$/, '');
}

/**
 * `base` if nothing has claimed it, otherwise `base-2`, `base-3` and so on until
 * one is free. `taken` is the set of slugs already in use in the scope this slug
 * has to be unique within — see model/updates.ts, where that scope is a single
 * project's posts or a single campaign's campaign-level posts, never both.
 *
 * Numbered rather than random because a collision is usually a genuine sequel —
 * two visits to the same family — and `the-family-came-home-2` reads as one.
 */
export function uniqueSlug(base: string, taken: Set<string>): string {
	// A caller that derived `base` from slugifyTitle can never pass an empty
	// string; this guards the one that built it some other way, because an empty
	// slug would produce a URL that resolves to the index instead of the post.
	const start = base || FALLBACK_SLUG;
	if (!taken.has(start)) return start;

	// Terminates: `taken` is finite and every iteration tries a candidate that
	// has not been tried before.
	let suffix = 2;
	let candidate = `${start}-${suffix}`;
	while (taken.has(candidate)) {
		suffix += 1;
		candidate = `${start}-${suffix}`;
	}
	return candidate;
}
