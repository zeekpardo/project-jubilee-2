// ============================================================
// Where a sign-in may send someone afterwards
// ============================================================
// One rule, used by every page that accepts `?redirectTo=`. Pure, like the rest
// of lib/domain, and here rather than inline in the login page for the reason
// the ordering below explains: this is the kind of check that looks obviously
// right and is quietly wrong, so it belongs somewhere the wrong versions can be
// written down as failing tests.
//
// The attack it exists to stop: a donor is handed a link to their own charity's
// real login page, on the real domain, with a redirect that lands them on an
// attacker's clone once they have authenticated. On a donation site the page
// they land on asks for card details, and every signal a careful person checks
// — the domain, the padlock, the charity's branding — was genuine right up
// until the redirect.
// ============================================================

/**
 * A same-site path to return to after signing in, or `fallback` when the
 * candidate cannot be shown to be one.
 *
 * Refuses anything that is not a single-slash-rooted relative path. Absolute
 * URLs are refused whether or not their host looks familiar, because deciding
 * that `https://jubilee.example.evil.com` is "our domain" is a string-matching
 * problem nobody wins.
 *
 * THE STRIP COMES FIRST, and that order is the whole subtlety. Browsers remove
 * tab, newline and carriage return from URLs themselves, so a check that runs
 * before the strip is checking a string the browser will never see:
 * `"/\t/evil.example"` starts with exactly one slash, passes a naive
 * protocol-relative test, and is then normalised by the browser into
 * `"//evil.example"` — a foreign origin, admitted by a guard that ran too early.
 *
 * A bad candidate falls back rather than throwing. Someone whose link was
 * mangled, or crafted, should still be able to sign in; they simply arrive at
 * the fallback instead of wherever the parameter asked for.
 */
export function safeRedirectTo(raw: string | null | undefined, fallback: string): string {
	if (!raw) return fallback;

	const candidate = raw.replace(/[\t\n\r]/g, '');

	if (!candidate.startsWith('/')) return fallback;

	// Both forms are read as protocol-relative and resolve to another origin.
	// Backslash is included because browsers normalise it to a forward slash in
	// this position, so `/\evil.example` is `//evil.example` by the time it is
	// fetched.
	if (candidate.startsWith('//') || candidate.startsWith('/\\')) return fallback;

	return candidate;
}
