<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { cn } from '$lib/primitives/utils';
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { ADMIN_NAV, CAMPAIGN_NAV, isAdminPath } from './nav-config';
	import { itemLabel, sectionLabel } from './nav-labels';
	import CampaignSwitcher from './CampaignSwitcher.svelte';

	let {
		class: className,
		onSelect
	}: {
		class?: string;
		/** Fires when a nav entry is chosen, so the mobile slide-over can close. */
		onSelect?: () => void;
	} = $props();

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

<div class={cn('bg-sidebar text-sidebar-foreground flex h-full w-full min-w-0 flex-col', className)}>
	<div class="flex flex-col gap-2 p-2">
		<CampaignSwitcher />
	</div>

	<nav class="flex min-h-0 flex-1 flex-col gap-2 overflow-auto" aria-label="Main">
		<div class="relative flex w-full min-w-0 flex-col p-2">
			<div
				class="text-sidebar-foreground/70 flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium"
			>
				{sectionLabel(inAdmin ? 'admin' : 'overview')}
			</div>

			<ul class="flex w-full min-w-0 flex-col gap-1">
				{#each items as item (item.key)}
					{@const Icon = item.icon}
					{@const current = isActive(item.href)}
					<li class="group/menu-item relative">
						<a
							href={resolve(item.href)}
							aria-current={current ? 'page' : undefined}
							data-active={current}
							onclick={() => onSelect?.()}
							class="ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden transition-[width,padding] focus-visible:ring-2 data-[active=true]:font-medium [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0"
						>
							<Icon />
							<span>
								{item.usesObjectLabel ? active.objectLabelPlural : itemLabel(item.key)}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</div>
	</nav>
</div>
