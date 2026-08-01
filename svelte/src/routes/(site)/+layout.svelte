<script lang="ts">
	import '$lib/features/public-site/public.css';

	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import SiteHeader from '$lib/features/public-site/SiteHeader.svelte';
	import SiteFooter from '$lib/features/public-site/SiteFooter.svelte';

	let { data, children } = $props();

	const homeHref = $derived(resolve('/(site)/[orgSlug]', { orgSlug: data.orgProfile.slug }));

	// `data` here is only this layout's load merged with ITS ancestors — a
	// descendant campaign page's overridden theme never flows back up through
	// props. `page.data` is the merged dataset for the whole active route
	// (every load in the chain, including the leaf page), so it picks up a
	// campaign's `campaign.theme ?? orgProfile.theme ?? 'jubilee'` override
	// when one is in scope, and falls back to this layout's own `data.theme`
	// (the org default) everywhere else.
	const theme = $derived((page.data.theme as string | undefined) ?? data.theme);
</script>

<!--
	`bg-background text-foreground` has to sit on the SAME element as
	`data-theme`, not be inherited from <html>. The theme files key their dark
	tokens on `[data-theme='x'].dark`, and this wrapper deliberately never gets
	`.dark` — the public site is light-only for now, independent of the
	visitor's OS setting and of whatever mode the admin app left in its cookie.
	Setting the palette here but not the surface it paints on is what breaks:
	the subtree resolves light-mode text while the page behind it is still the
	admin's dark background, i.e. dark text on dark.
-->
<div data-theme={theme} class="bg-background text-foreground flex min-h-[100dvh] flex-col">
	<SiteHeader orgName={data.orgProfile.name} {homeHref} />
	<main class="flex-1">
		{@render children()}
	</main>
	<SiteFooter orgName={data.orgProfile.name} tagline={data.orgProfile.tagline} />
</div>
