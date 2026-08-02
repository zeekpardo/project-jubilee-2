// ============================================================
// Public video embedding — pure URL → render strategy
// ============================================================
// Turns a record's videoUrl into how the public profile should show it.
// YouTube and Vimeo become responsive iframes (privacy-friendly
// youtube-nocookie where possible); every other host — Instagram, Facebook,
// TikTok — falls back to an outbound link, because embedding those means
// loading third-party JS on a page served to people whose safety depends on
// this site leaking nothing.
//
// This is also the only place a stored video URL is validated. The value is
// admin-entered, so it is trusted about as far as any free-text field: an
// unparseable URL, or one whose scheme is not http(s), yields null and the
// section is skipped entirely. Putting a raw `javascript:` or `data:` value
// into an href would make an admin typo — or a compromised admin account —
// executable in a visitor's browser.
// ============================================================

export type VideoEmbed = { kind: 'iframe'; src: string } | { kind: 'link'; href: string };

/** The YouTube id from any of its common URL shapes, or null. */
function youtubeId(url: URL): string | null {
	const host = url.hostname.replace(/^www\./, '').toLowerCase();

	if (host === 'youtu.be') {
		return url.pathname.split('/').filter(Boolean)[0] ?? null;
	}

	if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
		const v = url.searchParams.get('v');
		if (v) return v;

		// /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
		const parts = url.pathname.split('/').filter(Boolean);
		if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0])) {
			return parts[1];
		}
	}

	return null;
}

/** The numeric Vimeo id, or null. */
function vimeoId(url: URL): string | null {
	const host = url.hostname.replace(/^www\./, '').toLowerCase();
	if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;

	const parts = url.pathname.split('/').filter(Boolean);
	const candidate = parts[0] === 'video' ? parts[1] : parts[0];
	return candidate && /^\d+$/.test(candidate) ? candidate : null;
}

/** Null when there is nothing safe to show, so callers skip the section. */
export function toVideoEmbed(url: string | null | undefined): VideoEmbed | null {
	const trimmed = url?.trim();
	if (!trimmed) return null;

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return null;
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

	const youtube = youtubeId(parsed);
	if (youtube) {
		return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${youtube}` };
	}

	const vimeo = vimeoId(parsed);
	if (vimeo) {
		return { kind: 'iframe', src: `https://player.vimeo.com/video/${vimeo}` };
	}

	return { kind: 'link', href: trimmed };
}
