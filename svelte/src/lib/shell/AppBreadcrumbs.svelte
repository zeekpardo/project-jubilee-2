<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import * as Breadcrumb from '$lib/primitives/ui/breadcrumb';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { ADMIN_NAV, ADMIN_ROOT, CAMPAIGN_NAV, type NavItem } from './nav-config';
	import { itemLabel, sectionLabel } from './nav-labels';

	const active = getActiveCampaignContext();

	// Crumbs are derived from the path, so a new route gets a trail for free.
	// Anything the nav knows about is named by the nav; the rest falls back to
	// the segment itself, which is what a record id or number should read as.
	const NAV_BY_HREF = new Map<string, NavItem>(
		[...CAMPAIGN_NAV, ...ADMIN_NAV].map((item) => [item.href as string, item])
	);

	function labelFor(href: string, segment: string): string {
		const item = NAV_BY_HREF.get(href);
		if (item) return item.usesObjectLabel ? active.objectLabelPlural : itemLabel(item.key);
		if (href === ADMIN_ROOT) return sectionLabel('admin');
		const raw = decodeURIComponent(segment).replace(/[-_]/g, ' ');
		return raw.charAt(0).toUpperCase() + raw.slice(1);
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
					<Breadcrumb.Page>{crumb.label}</Breadcrumb.Page>
				{:else}
					<Breadcrumb.Link href={resolve(crumb.href as Pathname)}>{crumb.label}</Breadcrumb.Link>
				{/if}
			</Breadcrumb.Item>
		{/each}
	</Breadcrumb.List>
</Breadcrumb.Root>
