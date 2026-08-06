<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import * as m from '$lib/i18n/messages';

	// The slug arrives as a prop, taken from the layout's `data.orgProfile.slug`
	// rather than read here from `page.params.orgSlug`. Both hold the same
	// characters, but only one of them has been checked: the load turns that URL
	// segment into a real org and 404s when it does not name one, so by the time
	// this renders the profile's slug is a slug an org actually answers to. It is
	// also the field the header's home link and the viewer subscription are built
	// from, which means the tabs cannot send someone to a different org than the
	// chrome around them names.
	let { orgSlug }: { orgSlug: string } = $props();

	// `exact` is set on Home alone. Home is the parent path of the other four, so
	// testing it with `startsWith` would leave it lit on every page in the group
	// and the row would claim two current tabs at once. The other four want the
	// opposite rule, because `/me/records/1204` is a story being read and Stories
	// is still where the reader is.
	const TABS = [
		{ route: '/(me)/[orgSlug]/me', exact: true, label: () => m.portal_navHome() },
		{ route: '/(me)/[orgSlug]/me/giving', exact: false, label: () => m.portal_navGiving() },
		{ route: '/(me)/[orgSlug]/me/records', exact: false, label: () => m.portal_navRecords() },
		{ route: '/(me)/[orgSlug]/me/tasks', exact: false, label: () => m.portal_navTasks() },
		{ route: '/(me)/[orgSlug]/me/trips', exact: false, label: () => m.portal_navTrips() },
		{ route: '/(me)/[orgSlug]/me/profile', exact: false, label: () => m.portal_navProfile() }
	] as const;

	// The descendant test compares against `${href}/` rather than the bare href
	// so that a sibling route whose name merely begins with another's — a future
	// `/me/givingHistory` beside `/me/giving` — cannot hold the wrong tab open.
	function isCurrent(href: string, exact: boolean): boolean {
		const path = page.url.pathname;
		if (exact) return path === href;
		return path === href || path.startsWith(`${href}/`);
	}
</script>

<!--
	The row itself is the scroll container: five labels do not fit across a phone,
	and the alternative — letting them wrap — moves the page's content down by a
	line on exactly the screens with the least room for it. `overflow-x-auto`
	also makes the box clip vertically, which is why nothing here is taller than
	one line; a nested vertical scrollbar inside a page that already scrolls is
	the failure this shape has to avoid.

	The negative margins undo the `<main>` padding so the row can be swiped to
	the edge of the screen rather than stopping short of it, and the padding is
	restored inside so the first and last labels still line up with the text
	above them.
-->
<nav
	aria-label={m.portal_navigation()}
	class="border-border/70 -mx-4 mb-6 flex gap-6 overflow-x-auto border-b px-4 sm:-mx-6 sm:px-6"
>
	{#each TABS as tab (tab.route)}
		{@const current = isCurrent(resolve(tab.route, { orgSlug }), tab.exact)}
		<!--
			`resolve()` is called at the attribute rather than assigned to a variable
			first because that is the only form `svelte/no-navigation-without-resolve`
			recognises, the same reason `SiteAccountMenu` inlines its own. That is
			also why it is called a second time just above instead of the two sharing
			one binding: the rule reads the attribute, not the value behind it, and
			the alternative is an eslint-disable over the whole loop.

			A real anchor, not a button: these are pages, and a donor who wants their
			giving history in a second tab should get it the way they get it
			everywhere else.
		-->
		<a
			href={resolve(tab.route, { orgSlug })}
			aria-current={current ? 'page' : undefined}
			class="ps-serif focus-visible:ring-ring -mb-px border-b-2 py-3 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none {current
				? 'border-primary text-foreground font-semibold'
				: 'text-muted-foreground/80 hover:text-foreground border-transparent'}"
		>
			{tab.label()}
		</a>
	{/each}
</nav>
