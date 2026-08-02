import { describe, expect, it } from 'vitest';
import { toVideoEmbed } from './video-embed';

describe('toVideoEmbed', () => {
	it('returns null when there is nothing to show', () => {
		expect(toVideoEmbed(null)).toBeNull();
		expect(toVideoEmbed(undefined)).toBeNull();
		expect(toVideoEmbed('')).toBeNull();
		expect(toVideoEmbed('   ')).toBeNull();
	});

	it('returns null for a URL it cannot parse', () => {
		expect(toVideoEmbed('not a url')).toBeNull();
		expect(toVideoEmbed('youtube.com/watch?v=abc')).toBeNull();
	});

	// The security-critical case: these must never reach an href.
	it('refuses any scheme other than http(s)', () => {
		expect(toVideoEmbed('javascript:alert(1)')).toBeNull();
		expect(toVideoEmbed('JavaScript:alert(1)')).toBeNull();
		expect(toVideoEmbed('data:text/html,<script>alert(1)</script>')).toBeNull();
		expect(toVideoEmbed('vbscript:msgbox(1)')).toBeNull();
		expect(toVideoEmbed('file:///etc/passwd')).toBeNull();
	});

	it('embeds every common YouTube shape via youtube-nocookie', () => {
		const expected = { kind: 'iframe', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' };
		expect(toVideoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual(expected);
		expect(toVideoEmbed('https://youtube.com/watch?v=dQw4w9WgXcQ')).toEqual(expected);
		expect(toVideoEmbed('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual(expected);
		expect(toVideoEmbed('https://youtu.be/dQw4w9WgXcQ')).toEqual(expected);
		expect(toVideoEmbed('https://www.youtube.com/embed/dQw4w9WgXcQ')).toEqual(expected);
		expect(toVideoEmbed('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toEqual(expected);
		expect(toVideoEmbed('https://www.youtube.com/live/dQw4w9WgXcQ')).toEqual(expected);
	});

	it('keeps extra query params out of the embed src', () => {
		expect(toVideoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toEqual({
			kind: 'iframe',
			src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
		});
	});

	it('embeds Vimeo only when the id is numeric', () => {
		expect(toVideoEmbed('https://vimeo.com/123456789')).toEqual({
			kind: 'iframe',
			src: 'https://player.vimeo.com/video/123456789'
		});
		expect(toVideoEmbed('https://player.vimeo.com/video/123456789')).toEqual({
			kind: 'iframe',
			src: 'https://player.vimeo.com/video/123456789'
		});
		// A channel or category path is not a video.
		expect(toVideoEmbed('https://vimeo.com/channels/staffpicks')).toEqual({
			kind: 'link',
			href: 'https://vimeo.com/channels/staffpicks'
		});
	});

	it('links out rather than embedding third-party players', () => {
		for (const url of [
			'https://www.instagram.com/reel/abc123/',
			'https://www.facebook.com/watch?v=123',
			'https://www.tiktok.com/@someone/video/123'
		]) {
			expect(toVideoEmbed(url)).toEqual({ kind: 'link', href: url });
		}
	});

	it('trims surrounding whitespace before deciding', () => {
		expect(toVideoEmbed('  https://youtu.be/dQw4w9WgXcQ  ')).toEqual({
			kind: 'iframe',
			src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
		});
	});
});
