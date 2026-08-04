// The editor and `$lib/domain/rich-text.ts` have to agree about bytes, and this
// is where that agreement is pinned. It exercises the remark half of
// `platform-directives.ts` — the syntax extensions and their serializer options
// — without a browser, because that half is what decides whether a stored body
// survives a save.
//
// The ProseMirror half needs a DOM and is not covered here; what is covered is
// the part that would quietly rewrite or break every body in the database.

import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { directiveFromMarkdown, directiveToMarkdown } from 'mdast-util-directive';
import { directive } from 'micromark-extension-directive';
import { describe, expect, it } from 'vitest';

import { renderRichText } from '$lib/domain/rich-text';

/**
 * The same three options `platform-directives.ts` pins. Repeated rather than
 * imported because that module pulls in `@milkdown/kit`, which needs a browser;
 * if these ever drift apart the assertions below stop describing the shipped
 * editor, so they are asserted against `renderRichText` too.
 */
function processor() {
	return unified()
		.use(remarkParse)
		.use(function directiveSyntax() {
			const data = this.data();
			(data.micromarkExtensions ??= []).push(directive());
			(data.fromMarkdownExtensions ??= []).push(directiveFromMarkdown());
			(data.toMarkdownExtensions ??= []).push(
				directiveToMarkdown({
					preferShortcut: false,
					collapseEmptyAttributes: false,
					quote: '"'
				})
			);
		})
		.use(remarkStringify, { bullet: '-', rule: '-', ruleRepetition: 3 });
}

function roundTrip(markdown: string): string {
	const file = processor().processSync(markdown);
	return String(file).trim();
}

const ASSETS = { kg7: 'https://files.example/kg7' };

describe('platform directive round trip', () => {
	it('keeps an image directive in the exact stored form', () => {
		expect(roundTrip('::image{id=kg7 alt=""}')).toBe('::image{id="kg7" alt=""}');
	});

	it('never collapses an empty alt to a bare attribute', () => {
		// A bare `alt` re-parses fine but rewrites the bytes of every stored body,
		// so a save that changed nothing would show up as a change.
		expect(roundTrip('::image{id=kg7 alt=""}')).not.toContain('alt}');
	});

	it('never rewrites id to the `#` shorthand', () => {
		expect(roundTrip('::image{id=kg7 alt=""}')).not.toContain('#kg7');
	});

	it('QUOTES A VIDEO URL CONTAINING `=`', () => {
		// The one that matters. Unquoted, the value ends at the first `=`, the
		// line stops being a directive, and the markup prints on the public page.
		const out = roundTrip('::video{url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"}');
		expect(out).toBe('::video{url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"}');
	});

	it('quotes a video URL even when it contains nothing that needs quoting', () => {
		// `preferUnquoted` is off precisely so this stays quoted. A sometimes-bare
		// form would teach the next reader that bare is acceptable.
		expect(roundTrip('::video{url="https://vimeo.com/123456789"}')).toBe(
			'::video{url="https://vimeo.com/123456789"}'
		);
	});

	it('leaves list and rule markers as the previous editor wrote them', () => {
		expect(roundTrip('- one\n- two\n\n---')).toBe('- one\n- two\n\n---');
	});

	it('renders identically before and after a round trip', () => {
		const before = '::image{id=kg7 alt="A family of six"}';
		expect(renderRichText(roundTrip(before), ASSETS)).toBe(renderRichText(before, ASSETS));
	});

	it('still parses as a directive after the round trip, not as text', () => {
		const out = roundTrip('::video{url="https://www.youtube.com/watch?v=abc"}');
		expect(renderRichText(out)).toContain('<iframe');
		expect(renderRichText(out)).not.toContain('::video');
	});
});
