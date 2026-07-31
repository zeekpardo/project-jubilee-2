<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { cn } from '$lib/primitives/utils';
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { ADMIN_NAV, CAMPAIGN_NAV, isAdminPath } from './nav-config';
	import { itemLabel } from './nav-labels';
	import CampaignSwitcher from './CampaignSwitcher.svelte';

	let { class: className }: { class?: string } = $props();

	const access = getAccessContext();
	const active = getActiveCampaignContext();

	const inAdmin = $derived(isAdminPath(page.url.pathname));

	// Admin is a mode, not a section: the campaign workspace never shows
	// org-wide entries, and admin never shows campaign ones.
	const items = $derived(
		(inAdmin ? ADMIN_NAV : CAMPAIGN_NAV).filter((item) => access.can(item.capability, active.id))
	);

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/app') return path === '/app';
		return path === href || path.startsWith(`${href}/`);
	}
</script>

<nav class={cn('flex h-full flex-col gap-4 p-3', className)} aria-label="Main">
	<div class="px-1">
		<CampaignSwitcher />
	</div>

	<div class="flex flex-1 flex-col gap-1 overflow-y-auto">
		{#each items as item (item.key)}
			{@const Icon = item.icon}
			{@const current = isActive(item.href)}
			<a
				href={resolve(item.href)}
				aria-current={current ? 'page' : undefined}
				class={cn(
					'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors',
					current
						? 'bg-card border-border text-foreground border font-medium'
						: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground border border-transparent'
				)}
			>
				<Icon class="size-4 shrink-0" />
				<span class="truncate">
					{item.usesObjectLabel ? active.objectLabelPlural : itemLabel(item.key)}
				</span>
			</a>
		{/each}
	</div>
</nav>
