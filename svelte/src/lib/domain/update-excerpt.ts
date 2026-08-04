// ============================================================
// Update excerpts — markdown in, shorter markdown out
// ============================================================
// A record page shows the newest update as a lead: the first few paragraphs,
// rendered, with "Read more" to the permalink. The obvious way to build that is
// to render the whole body and clamp it with CSS, and that is wrong here. These
// pages are served from a CDN under `s-maxage=300`, so a clamped body is the
// FULL body sitting in the HTML every visitor downloads and every intermediary
// caches — invisible, but paid for, and readable to anyone who opens the source.
// An update is free prose an org wrote about a named family; "you cannot see it
// because of `line-clamp`" is not a way to withhold anything.
//
// So the cut happens to the MARKDOWN, before `renderRichText` ever sees it, in a
// load function. What is not kept is never rendered, never serialized, and never
// leaves the server.
//
// This module is deliberately the shallow one. `richTextExcerpt` in
// `./rich-text.ts` already parses markdown properly and returns plain text, and
// that is the right tool wherever the excerpt is a sentence in a card or a
// `<meta>` description. What it cannot do is give back MARKDOWN — the lead needs
// real headings, emphasis and photographs, which means the truncated result has
// to go through the renderer afterwards. Hence a separate function that works on
// the source text and hands the result to the same pipeline as everything else.
//
// It counts blocks rather than characters on purpose. A character budget cuts
// mid-sentence, or mid-`::image{id=...}` directive, and a half-written directive
// is markup the admin never wrote appearing on a donor's screen. Whole blocks
// can only ever end where the author already ended something.
//
// A SUPPORTED MULTI-LINE DIRECTIVE WOULD HAVE TO BE TAUGHT TO `splitBlocks`
// BELOW, and the emphasis is on SUPPORTED. This module does not parse markdown —
// it splits on blank lines and knows about exactly one construct that may
// legally contain one, the fenced code block. That is sound for every directive
// the editor emits today, because `::image` and `::video` are LEAF directives:
// one line each, so no blank line can fall inside them.
//
// A container directive (`:::name` ... `:::`) does span blank lines, so this
// splitter would cut one in half — and TODAY THAT IS HARMLESS, which is worth
// stating so nobody 'fixes' it in the wrong direction. `rich-text.ts` renders a
// container to nothing at all: `remarkPlatformDirectives` splices out every
// directive that is not `image` or `video`, children and all, whether or not it
// was terminated. `rich-text.test.ts` pins it. So a container's prose reaches no
// page, cut or uncut, and the excerpt and the full article agree — both show
// nothing.
//
// The hazard is conditional and it is a DIVERGENCE, not a drop. The day someone
// teaches `rich-text.ts` to KEEP a container directive, the permalink starts
// rendering the prose inside it while this function is still splitting blindly
// on blank lines — so the lead on a record page would silently disagree with the
// page its own "Read more" links to. The fix is two-sided when that day comes:
// `truncateMarkdown` learns to track `:::` alongside `fence`, AND `rich-text.ts`
// keeps the directive. Doing only the first would faithfully preserve prose the
// renderer then deletes. Whoever adds the directive owns both halves.
//
// No IO, no Svelte, no database types — the same rule `rich-text.ts` states for
// itself, and the reason both are testable as plain functions.
// ============================================================

/** What `truncateMarkdown` gives back. */
export type MarkdownTruncation = {
	/** The kept markdown, ready to hand to `renderRichText`. */
	markdown: string;
	/**
	 * True when at least one block was dropped. The caller shows "Read more" on
	 * this and nothing else: it must not re-derive the answer by comparing
	 * lengths, because the two would disagree the first time this function
	 * normalizes whitespace.
	 */
	truncated: boolean;
};

/**
 * A fence opener or closer: three or more backticks or tildes, indented no more
 * than three spaces, which is how CommonMark defines one.
 */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Splits markdown into blank-line-separated blocks, treating a fenced code block
 * as ONE block however many blank lines are inside it.
 *
 * The fence tracking is not a nicety. Splitting naively puts the truncation
 * boundary inside a fence, and an unterminated fence is not a shorter code block
 * — CommonMark runs it to the end of the document, so the paragraph that
 * followed would be published as source code. Whole-block truncation only means
 * anything if the blocks are the ones the author actually wrote.
 *
 * A fence is the ONLY multi-line construct handled here, and it is the only one
 * whose contents currently survive rendering — see the header. A `:::` container
 * is cut through the middle by this loop and that costs nothing today, because
 * `rich-text.ts` discards containers whole. Track it alongside `fence` on the
 * day the renderer starts keeping one, and not before.
 */
function splitBlocks(markdown: string): string[] {
	const blocks: string[] = [];
	let current: string[] = [];
	// The opening fence's run, so a `~~~` inside a ``` block cannot close it and
	// a shorter run of the same character cannot either.
	let fence: string | null = null;

	const flush = () => {
		const block = current.join('\n').trim();
		if (block) blocks.push(block);
		current = [];
	};

	for (const line of markdown.split(/\r\n|\r|\n/)) {
		const marker = FENCE.exec(line)?.[1];

		if (marker) {
			if (fence === null) {
				fence = marker;
			} else if (marker[0] === fence[0] && marker.length >= fence.length) {
				fence = null;
			}
			current.push(line);
			continue;
		}

		if (fence === null && line.trim() === '') {
			flush();
			continue;
		}

		current.push(line);
	}

	flush();
	return blocks;
}

/**
 * The first `maxBlocks` blocks of `markdown`, and whether anything was dropped.
 *
 * Never cuts inside a block, so the result always ends where the author ended a
 * paragraph, a list or a photograph. The output is markdown, not HTML: pass it
 * to `renderRichText` exactly as you would the full body, with the same asset
 * map — an image directive in a kept block still has to resolve.
 */
export function truncateMarkdown(markdown: string, maxBlocks = 3): MarkdownTruncation {
	if (!markdown?.trim()) return { markdown: '', truncated: false };

	const blocks = splitBlocks(markdown);

	// A non-positive budget keeps nothing, and says so — a caller passing 0 still
	// needs to know a body exists so it can offer the way through to it.
	if (maxBlocks <= 0) return { markdown: '', truncated: blocks.length > 0 };

	return {
		markdown: blocks.slice(0, maxBlocks).join('\n\n'),
		truncated: blocks.length > maxBlocks
	};
}
