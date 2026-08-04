import { describe, expect, it } from 'vitest';
import { truncateMarkdown } from './update-excerpt';

describe('truncateMarkdown', () => {
	it('returns nothing for a body with nothing in it', () => {
		expect(truncateMarkdown('')).toEqual({ markdown: '', truncated: false });
		expect(truncateMarkdown('   \n\n  ')).toEqual({ markdown: '', truncated: false });
	});

	it('leaves a body shorter than the budget alone', () => {
		const body = 'First paragraph.\n\nSecond paragraph.';
		expect(truncateMarkdown(body, 3)).toEqual({ markdown: body, truncated: false });
	});

	it('reports no truncation when the body is exactly the budget', () => {
		expect(truncateMarkdown('one\n\ntwo\n\nthree', 3)).toEqual({
			markdown: 'one\n\ntwo\n\nthree',
			truncated: false
		});
	});

	it('keeps the first blocks and reports the rest were dropped', () => {
		expect(truncateMarkdown('one\n\ntwo\n\nthree\n\nfour', 2)).toEqual({
			markdown: 'one\n\ntwo',
			truncated: true
		});
	});

	// The whole point of counting blocks: the cut can only land where the author
	// already stopped writing.
	it('never cuts inside a sentence', () => {
		const body = 'A sentence that runs on and on and on.\n\nAnother one entirely.';
		expect(truncateMarkdown(body, 1).markdown).toBe('A sentence that runs on and on and on.');
	});

	it('collapses runs of blank lines and trims trailing space', () => {
		expect(truncateMarkdown('one\n\n\n\ntwo   \n\n   \n\nthree', 2)).toEqual({
			markdown: 'one\n\ntwo',
			truncated: true
		});
	});

	it('treats a heading and the lines under it as one block', () => {
		const body = '## A heading\nThe line straight after it.\n\nA later paragraph.';
		expect(truncateMarkdown(body, 1)).toEqual({
			markdown: '## A heading\nThe line straight after it.',
			truncated: true
		});
	});

	it('keeps a list together when its items are not blank-line separated', () => {
		const body = '- one\n- two\n- three\n\nAfter the list.';
		expect(truncateMarkdown(body, 1)).toEqual({
			markdown: '- one\n- two\n- three',
			truncated: true
		});
	});

	// An unterminated fence runs to the end of the document in CommonMark, so a
	// split inside one would publish the following prose as source code.
	it('does not split a fenced code block on the blank lines inside it', () => {
		const body = '```\nline one\n\nline two\n```\n\nProse after the code.';
		expect(truncateMarkdown(body, 1)).toEqual({
			markdown: '```\nline one\n\nline two\n```',
			truncated: true
		});
	});

	it('does not let a tilde fence close a backtick fence', () => {
		const body = '```\ncode\n~~~\n\nstill code\n```\n\nProse.';
		expect(truncateMarkdown(body, 1).markdown).toBe('```\ncode\n~~~\n\nstill code\n```');
	});

	it('does not let a shorter run close a longer fence', () => {
		const body = '````\ncode\n```\n\nstill code\n````\n\nProse.';
		expect(truncateMarkdown(body, 1).markdown).toBe('````\ncode\n```\n\nstill code\n````');
	});

	// A photograph is a leaf directive on its own line; half of one is markup the
	// admin never wrote showing up on a donor's screen.
	it('keeps an image directive whole', () => {
		const body = 'Opening words.\n\n::image{id=abc123 alt="A doorway"}\n\nClosing words.';
		expect(truncateMarkdown(body, 2)).toEqual({
			markdown: 'Opening words.\n\n::image{id=abc123 alt="A doorway"}',
			truncated: true
		});
	});

	it('keeps nothing but still reports truncation for a non-positive budget', () => {
		expect(truncateMarkdown('one\n\ntwo', 0)).toEqual({ markdown: '', truncated: true });
		expect(truncateMarkdown('one\n\ntwo', -5)).toEqual({ markdown: '', truncated: true });
	});

	it('handles carriage returns from a paste out of a Windows editor', () => {
		expect(truncateMarkdown('one\r\n\r\ntwo\r\n\r\nthree', 2)).toEqual({
			markdown: 'one\n\ntwo',
			truncated: true
		});
	});

	it('defaults to three blocks', () => {
		expect(truncateMarkdown('one\n\ntwo\n\nthree\n\nfour').markdown).toBe('one\n\ntwo\n\nthree');
	});
});
