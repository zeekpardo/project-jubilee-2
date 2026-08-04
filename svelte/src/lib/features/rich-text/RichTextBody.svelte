<script lang="ts">
	// Renders prose that `$lib/domain/rich-text.ts` has already turned into HTML.
	// It is the read side of RichTextEditor and, like the editor, knows nothing
	// about what the prose is: any page with a body to show uses this one.
	let { html }: { html: string } = $props();
</script>

<!--
	THIS IS THE ONLY `{@html}` IN THE APPLICATION, AND IT MUST STAY THAT WAY.

	Svelte does not sanitize anything here. `{@html}` inserts the string into the
	document exactly as given; there is no escaping, no filtering and no parser
	that will save a caller who hands it something else. Every guarantee this
	line depends on was made upstream, in `$lib/domain/rich-text.ts`:

	  - Raw HTML is never parsed at all. `remark-rehype` leaves
	    `allowDangerousHtml` at false, so an `<img onerror=...>` typed into the
	    editor is dropped on the floor before any sanitizer is consulted.
	  - Every element in the output is CONSTRUCTED there from a value that module
	    validated — an img src comes from a resolved asset map, an iframe src
	    comes from `toVideoEmbed` — rather than copied out of the author's text.
	  - The tree is then run through `rehype-sanitize` against a schema that
	    names the handful of tags the editor can actually produce and narrows
	    href and src to http and https.

	So NOTHING BUT THE RETURN VALUE OF `renderRichText` MAY EVER BE PASSED TO
	THIS COMPONENT. Not a string from a Convex row, not a fetch response, not
	markdown someone rendered with a different pipeline "just this once", and not
	HTML assembled here because it was easier than adding a case to the domain
	module. The readers of these pages are people escaping forced labour; script
	running in their browser is not a bug report, it is a disclosure of who they
	are. If a new kind of content needs rendering, teach `renderRichText` to emit
	it and this component keeps its single, checkable source.

	The eslint rule below is doing its job — it is disabled with the reasoning
	above, in the one place that was designed to satisfy it, and nowhere else.
-->
<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<div class="rich-text-body prose max-w-none">{@html html}</div>

<style>
	/*
		Tailwind Typography ships its own grey palette and its own dark variant,
		and both are wrong on this surface.

		`dark:prose-invert` keys off the `.dark` class on <html>, which the ADMIN
		app sets from its mode cookie. The public site deliberately never gets that
		class — its wrapper carries `data-theme` and is light-only, as the comment
		in `(site)/+layout.svelte` explains. So an admin who had once used dark mode
		made every donor-facing article render in the inverted palette: near-white
		body text on the site's light card. The variant is gone rather than
		corrected, because there is no page where this component should follow
		<html> instead of the theme it is sitting inside.

		The variables below are the whole of Typography's colour surface, bound to
		the app's own tokens so the prose inherits whichever theme wraps it.
		Custom properties inherit, so setting them here reaches the elements
		`{@html}` inserted even though those carry no scoping class.
	*/
	.rich-text-body {
		--tw-prose-body: var(--foreground);
		--tw-prose-headings: var(--foreground);
		--tw-prose-lead: var(--muted-foreground);
		--tw-prose-links: var(--primary);
		--tw-prose-bold: var(--foreground);
		--tw-prose-counters: var(--muted-foreground);
		--tw-prose-bullets: var(--muted-foreground);
		--tw-prose-hr: var(--border);
		--tw-prose-quotes: var(--foreground);
		--tw-prose-quote-borders: var(--border);
		--tw-prose-captions: var(--muted-foreground);
		--tw-prose-code: var(--foreground);
		--tw-prose-pre-code: var(--foreground);
		--tw-prose-pre-bg: var(--muted);
		--tw-prose-th-borders: var(--border);
		--tw-prose-td-borders: var(--border);

		/*
			Matched to `ArticleBody`, which renders the story immediately above this
			on the same page. Typography's defaults are 16px on a 1.75 rhythm, so an
			update sat under a story set in `text-lg leading-relaxed` and read as a
			different, smaller document by a different hand.
		*/
		font-size: 1.125rem;
		line-height: 1.75;
	}

	/*
		Typography spaces paragraphs at 1.25em top AND bottom, which stacks with the
		heading margins either side of them. Against the story's `space-y-4` the
		result was gaps wide enough to read as missing content. These bring the
		rhythm back to the surrounding page without flattening the hierarchy.
	*/
	.rich-text-body :global(p) {
		margin-block: 0.9em;
	}

	.rich-text-body :global(:is(h1, h2, h3, h4)) {
		margin-block: 1.4em 0.5em;
	}

	.rich-text-body :global(> :first-child) {
		margin-block-start: 0;
	}

	.rich-text-body :global(> :last-child) {
		margin-block-end: 0;
	}

	/* Matched to the rounding on the hero photo and the record cards. */
	.rich-text-body :global(img) {
		border-radius: 0.5rem;
	}
</style>
