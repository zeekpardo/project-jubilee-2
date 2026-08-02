<script lang="ts">
	import '$lib/features/public-site/public.css';

	import { page } from '$app/state';

	let { data, children } = $props();

	// Same override rule as the (site) layout: a campaign-scoped descendant's
	// `campaign.theme ?? orgProfile.theme ?? 'jubilee'` wins over this layout's
	// own org-level default once one is in scope.
	const theme = $derived((page.data.theme as string | undefined) ?? data.theme);

	let wrapper = $state<HTMLDivElement | null>(null);

	// An iframe cannot size itself to its content, so the host page needs the
	// real content height to resize the <iframe> around it. '*' is correct
	// for targetOrigin because the widget is public and does not know its
	// host — but that also means the payload must never carry anything beyond
	// a type tag and a number: no record data, ever, crosses this postMessage.
	//
	// Measured on the wrapper, NOT document.documentElement: the document can
	// never report less than the viewport it is in, so a widget shorter than
	// its frame — the stats strip, most obviously — would keep reporting the
	// frame's own height and could never shrink to fit.
	$effect(() => {
		const node = wrapper;
		if (!node) return;

		const postHeight = (): void => {
			window.parent.postMessage(
				{ type: 'jubilee-embed-height', height: node.getBoundingClientRect().height },
				'*'
			);
		};

		postHeight();
		const observer = new ResizeObserver(postHeight);
		observer.observe(node);

		return () => observer.disconnect();
	});
</script>

<!--
	`bg-background text-foreground` has to sit on the SAME element as
	`data-theme`, exactly like the (site) layout — see the comment there. This
	wrapper deliberately never gets `.dark` either: an embed is light-only,
	independent of whatever mode the host page (or, if the widget is ever
	opened directly, the visitor's own cookie) prefers. Setting the palette
	without the surface it paints on is what breaks: dark text on the host
	page's background bleeding through an unstyled iframe.
-->
<div bind:this={wrapper} data-theme={theme} class="bg-background text-foreground">
	{@render children()}
</div>
