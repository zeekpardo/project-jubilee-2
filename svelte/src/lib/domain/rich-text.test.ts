import { describe, expect, it } from 'vitest';

import { renderRichText, richTextExcerpt, type RichTextAssets } from './rich-text';

const assets: RichTextAssets = { kg7: 'https://files.example/kg7.jpg' };

const render = (markdown: string, resolved: RichTextAssets = assets) =>
	renderRichText(markdown, resolved);

describe('raw HTML in the body', () => {
	// The primary guarantee: remark-rehype never parses HTML, so these are
	// dropped before the sanitizer is even consulted.
	it('drops a script block rather than escaping it into the page', () => {
		const html = render('<script>alert(1)</script>');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('alert(1)');
	});

	it('drops an image tag carrying an onerror handler', () => {
		const html = render('<img src=x onerror=alert(1)>');
		expect(html).not.toContain('onerror');
		expect(html).not.toContain('<img');
	});

	it('drops a handwritten iframe, so the only iframes are the ones this module builds', () => {
		expect(render('<iframe src="https://evil.example"></iframe>')).not.toContain('<iframe');
	});

	it('keeps the surrounding prose when a tag is dropped mid-sentence', () => {
		expect(render('the family <b>moved</b> home')).toBe('<p>the family moved home</p>');
	});
});

describe('link protocols', () => {
	it('renders a javascript: link with no href at all', () => {
		const html = render('[click](javascript:alert(1))');
		expect(html).not.toContain('javascript:');
		expect(html).toBe('<p><a>click</a></p>');
	});

	it('refuses data: and mailto: hrefs, leaving only http and https', () => {
		expect(render('[click](data:text/html,hi)')).not.toContain('data:');
		expect(render('[write](mailto:someone@example.org)')).not.toContain('mailto:');
		expect(render('[read](https://example.org/story)')).toContain(
			'href="https://example.org/story"'
		);
	});
});

describe('::video', () => {
	it('embeds a YouTube URL through youtube-nocookie, never the tracking host', () => {
		const html = render('::video{url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"}');
		expect(html).toContain('<iframe');
		expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
		expect(html).not.toContain('www.youtube.com');
	});

	it('embeds a Vimeo URL through the player host', () => {
		expect(render('::video{url="https://vimeo.com/123456789"}')).toContain(
			'src="https://player.vimeo.com/video/123456789"'
		);
	});

	// An arbitrary host must never become a frame: embedding it would load
	// third-party JS on a page whose readers depend on this site leaking nothing.
	it('links out to any other host instead of framing it', () => {
		const html = render('::video{url="https://evil.example/clip"}');
		expect(html).not.toContain('<iframe');
		expect(html).toContain('<a href="https://evil.example/clip"');
		expect(html).toContain('rel="noopener noreferrer"');
	});

	it('renders nothing when the URL is not http(s)', () => {
		expect(render('::video{url="javascript:alert(1)"}')).toBe('');
		expect(render('::video{url="data:text/html,hi"}')).toBe('');
		expect(render('::video{url="not a url"}')).toBe('');
	});

	it('uses the directive label as the link text when the admin wrote one', () => {
		expect(render('::video[Watch the release]{url="https://www.tiktok.com/@a/video/1"}')).toContain(
			'>Watch the release</a>'
		);
	});
});

describe('::image', () => {
	it('renders an img at the URL the caller resolved', () => {
		expect(render('::image{id=kg7 alt="A family of six"}')).toBe(
			'<img src="https://files.example/kg7.jpg" alt="A family of six" loading="lazy">'
		);
	});

	// A withheld or deleted blob is an ordinary state. A broken image icon on a
	// published story is worse than no image, and a draft's assets are withheld
	// on purpose.
	it('renders nothing when the id is absent from the assets map', () => {
		expect(render('::image{id=kg7 alt="A family"}', {})).toBe('');
		expect(render('::image{id=unknown alt="A family"}')).toBe('');
		expect(render('::image{alt="no id at all"}')).toBe('');
	});

	// A plain `assets[id]` finds these on Object.prototype and reports success.
	it('renders nothing for an id that only exists on the prototype', () => {
		expect(render('::image{id=constructor}')).toBe('');
		expect(render('::image{id=toString}')).toBe('');
	});

	it('leaves the surrounding paragraphs intact when the image is dropped', () => {
		expect(render('before\n\n::image{id=kg7}\n\nafter', {})).toBe('<p>before</p>\n<p>after</p>');
	});

	it('ignores the class and id shorthands, which are read by no one', () => {
		const html = render('::image{#clobber .evil id=kg7}');
		expect(html).not.toContain('class');
		expect(html).not.toContain('clobber');
	});

	it('drops a directive it does not recognise instead of guessing at it', () => {
		expect(render(':::note\ninner\n:::')).toBe('');
		expect(render('::imge{id=kg7}')).not.toContain('<img');
	});
});

describe('ordinary formatting', () => {
	it('round-trips the marks an admin actually types', () => {
		expect(render('# Freedom day\n\n## Six people')).toBe(
			'<h1>Freedom day</h1>\n<h2>Six people</h2>'
		);
		expect(render('**bold** and *italic*')).toBe(
			'<p><strong>bold</strong> and <em>italic</em></p>'
		);
		expect(render('- one\n- two')).toBe('<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
		expect(render('1. one\n2. two')).toBe('<ol>\n<li>one</li>\n<li>two</li>\n</ol>');
		expect(render('> a quote')).toBe('<blockquote>\n<p>a quote</p>\n</blockquote>');
	});

	it('returns an empty string for a body with nothing in it', () => {
		expect(render('')).toBe('');
		expect(render('   \n\t\n  ')).toBe('');
	});

	it('never emits a style or event-handler attribute, whatever the input', () => {
		const html = render('# Title\n\n[link](https://example.org)\n\n::image{id=kg7}');
		expect(html).not.toMatch(/\sstyle=/);
		expect(html).not.toMatch(/\son[a-z]+=/);
	});
});

describe('richTextExcerpt', () => {
	it('strips every mark and leaves only what a reader would have read', () => {
		expect(richTextExcerpt('# Freedom day\n\n**Six** people came *home*.')).toBe(
			'Freedom day Six people came home.'
		);
	});

	it('separates blocks and list items so words do not run together', () => {
		expect(richTextExcerpt('- one\n- two\n\nlast')).toBe('one two last');
	});

	it('keeps emphasis inside a word whole', () => {
		expect(richTextExcerpt('un**believ**able')).toBe('unbelievable');
	});

	it('omits directives, so no storage id or embed URL reaches a meta description', () => {
		expect(richTextExcerpt('::image{id=kg7 alt="A family"}\n\nThey are home.')).toBe(
			'They are home.'
		);
		expect(richTextExcerpt('::video{url="https://youtu.be/dQw4w9WgXcQ"}\n\nThey are home.')).toBe(
			'They are home.'
		);
	});

	it('truncates on a word boundary and never exceeds the budget it was given', () => {
		const excerpt = richTextExcerpt('The family of six walked out of the brick kiln today.', 20);
		expect(excerpt).toBe('The family of six…');
		expect(excerpt.length).toBeLessThanOrEqual(20);
	});

	it('returns everything when the text is already short enough', () => {
		expect(richTextExcerpt('They are home.', 100)).toBe('They are home.');
	});

	it('returns an empty string rather than throwing on empty input', () => {
		expect(richTextExcerpt('')).toBe('');
		expect(richTextExcerpt('   ')).toBe('');
		expect(richTextExcerpt('anything', 0)).toBe('');
	});
});
