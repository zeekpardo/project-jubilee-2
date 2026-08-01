<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import * as Breadcrumb from '$lib/primitives/ui/breadcrumb';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { ADMIN_NAV, ADMIN_ROOT, CAMPAIGN_NAV, type NavItem } from './nav-config';
	import { itemLabel, sectionLabel } from './nav-labels';
	import { getCrumbTitleContext } from './crumb-title.svelte';

	const active = getActiveCampaignContext();
	const crumbTitle = getCrumbTitleContext();

	// Crumbs are derived from the path, so a new route gets a trail for free.
	// Anything the nav knows about is named by the nav; the rest falls back to
	// the segment itself. A detail page can name its own last crumb through
	// useCrumbTitle, which is the only way an opaque id segment ever reads as
	// the record's name.
	const NAV_BY_HREF = new Map<string, NavItem>(
		[...CAMPAIGN_NAV, ...ADMIN_NAV].map((item) => [item.href as string, item])
	);

	function labelFor(href: string, segment: string): string {
		const item = NAV_BY_HREF.get(href);
		if (item) return item.usesObjectLabel ? active.objectLabelPlural : itemLabel(item.key);
		if (href === ADMIN_ROOT) return sectionLabel('admin');
		// Every navigable route is named above, so what is left is always a record
		// identifier — an id or a number like P-001. Those are shown verbatim:
		// prettifying them would turn P-001 into "P 001", a number that matches
		// nothing the user can search for.
		return decodeURIComponent(segment);
	}

	const crumbs = $derived.by(() => {
		let href = '';
		return page.url.pathname
			.split('/')
			.filter(Boolean)
			.map((segment) => {
				href += `/${segment}`;
				return { href, label: labelFor(href, segment) };
			});
	});
</script>

<Breadcrumb.Root>
	<Breadcrumb.List>
		{#each crumbs as crumb, index (crumb.href)}
			{@const last = index === crumbs.length - 1}
			{#if index > 0}
				<Breadcrumb.Separator class="hidden md:block" />
			{/if}
			<Breadcrumb.Item class={last ? undefined : 'hidden md:block'}>
				{#if last}
					<Breadcrumb.Page>{crumbTitle.labelFor(crumb.href) ?? crumb.label}</Breadcrumb.Page>
				{:else}
					<Breadcrumb.Link href={resolve(crumb.href as Pathname)}>{crumb.label}</Breadcrumb.Link>
				{/if}
			</Breadcrumb.Item>
		{/each}
	</Breadcrumb.List>
</Breadcrumb.Root>
