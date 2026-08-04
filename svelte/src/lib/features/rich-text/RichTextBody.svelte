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
<div class="prose dark:prose-invert max-w-none">{@html html}</div>
