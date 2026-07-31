<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { cn } from '$lib/primitives/utils';
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { NAV_SECTIONS } from './nav-config';
	import { itemLabel, sectionLabel } from './nav-labels';
	import CampaignSwitcher from './CampaignSwitcher.svelte';

	let { class: className }: { class?: string } = $props();

	const access = getAccessContext();
	const active = getActiveCampaignContext();

	// A section disappears entirely when nothing in it is permitted, so an admin
	// never sees an empty "Administration" heading.
	const sections = $derived(
		NAV_SECTIONS.map((section) => ({
			...section,
			items: section.items.filter((item) => access.can(item.capability, active.id))
		})).filter((section) => section.items.length > 0)
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

	<div class="flex flex-1 flex-col gap-5 overflow-y-auto">
		{#each sections as section (section.key)}
			<div class="flex flex-col gap-1">
				<p class="text-muted-foreground px-2 text-xs font-medium tracking-wide uppercase">
					{sectionLabel(section.key)}
				</p>
				{#each section.items as item (item.key)}
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
		{/each}
	</div>
</nav>
