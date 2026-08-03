<script lang="ts">
	// These pages borrow the public site's stylesheet rather than the admin
	// shell's, and now its header and footer with it. A donor or a family member
	// arrives from an email or from the org's own front page, not from a working
	// session in an app, and the surface they land on should look like the one
	// they were reading a minute ago — because it is the same site, at the same
	// address, one segment further in.
	import '$lib/features/public-site/public.css';

	import { resolve } from '$app/paths';
	import SiteHeader from '$lib/features/public-site/SiteHeader.svelte';
	import SiteFooter from '$lib/features/public-site/SiteFooter.svelte';
	import { useSiteViewer } from '$lib/features/site/viewer.svelte';
	import { setSiteViewerContext } from '$lib/features/site/context.svelte';
	import * as m from '$lib/i18n/messages';

	let { data, children } = $props();

	const homeHref = $derived(resolve('/(site)/[orgSlug]', { orgSlug: data.orgProfile.slug }));

	// `SiteHeader` renders `SiteAccountMenu`, which reads the viewer from context
	// and THROWS when there is no provider — deliberately, so a component that
	// ended up outside the public site fails at the seam instead of quietly
	// showing the signed-out header to someone who is signed in. `(me)` is a
	// separate route group and inherits nothing from `(site)`, so it establishes
	// that context itself.
	//
	// It resolves in the BROWSER, exactly as its counterpart does. The reason is
	// not caching here — this group's load sets `private, no-store` — but
	// agreement: one subscription answers "who is looking" for the header on
	// both halves of the address, so the public page and this one can never
	// disagree about whether someone is signed in.
	const siteViewer = useSiteViewer(() => data.orgProfile.slug);
	setSiteViewerContext(siteViewer);
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
<div data-theme={data.theme} class="bg-background text-foreground flex min-h-[100dvh] flex-col">
	<SiteHeader orgName={data.orgProfile.name} {homeHref} />

	<main class="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
		{#if data.overview}
			<!--
				Guarded only because the load returns a null overview while building,
				when there is no session and so nobody to greet. No visitor reaches
				this branch: without a record at this org the load has already sent
				them to the org's front page.
			-->
			<p class="ps-serif mb-6 text-2xl leading-none font-semibold tracking-tight">
				{m.portal_greeting({ name: data.overview.profile.firstName })}
			</p>
		{/if}

		<!--
			The navigation between these pages belongs here, as `MeTabs`, in the step
			after this one. The old portal carried its own sticky header with the tab
			row inside it; that header is what `SiteHeader` replaces, so rebuilding
			the tabs into this shell now only to replace them next would be the same
			work done twice. Until then these pages are reachable by URL and by the
			links they already carry between one another.
		-->

		{@render children()}
	</main>

	<SiteFooter orgName={data.orgProfile.name} tagline={data.orgProfile.tagline} />
</div>
