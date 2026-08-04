<script lang="ts">
	// One update, whole, on its permalink. The campaign and record permalinks
	// share this so a post reads identically whichever parent it hangs off; only
	// the navigation around it differs, and that stays in the page files where
	// the routes are known.
	//
	// `html` is the FULL body here — this is the page the "Read more" on the
	// record page leads to, so truncation would defeat the point. It is still
	// sanitized HTML from `renderRichText` in the load function, and this
	// component still never imports the renderer.
	// Imported from its own module rather than through the package barrel, and
	// that is load-bearing rather than a style preference. The barrel also
	// re-exports `RichTextEditor`, which pulls in Milkdown and ProseMirror, so
	// importing the renderer through it puts the whole editor in this page's
	// module graph — and this is a CDN-cached donor page.
	import RichTextBody from '$lib/features/rich-text/RichTextBody.svelte';
	import UpdateDateline from '$lib/features/public-site/UpdateDateline.svelte';

	type Props = {
		title: string;
		/** Milliseconds, or null when the row was published before this was kept. */
		publishedAt: number | null;
		/** Sanitized HTML from the load function. Never raw admin markdown. */
		html: string;
	};

	let { title, publishedAt, html }: Props = $props();
</script>

<header>
	<h1 class="ps-serif text-foreground text-3xl leading-tight sm:text-4xl">{title}</h1>
	<UpdateDateline {publishedAt} class="mt-2 text-sm" />
</header>

<div class="mt-8">
	<RichTextBody {html} />
</div>
