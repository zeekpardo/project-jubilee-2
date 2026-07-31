<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { cn } from '$lib/primitives/utils';
	import * as Tooltip from '$lib/primitives/ui/tooltip';
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { getSidebarContext } from './sidebar.svelte';
	import { ADMIN_NAV, CAMPAIGN_NAV, isAdminPath, type NavItem } from './nav-config';
	import { itemLabel, sectionLabel } from './nav-labels';
	import CampaignSwitcher from './CampaignSwitcher.svelte';
	import NavUser from './NavUser.svelte';

	import type {
		GetActiveOrganizationType,
		GetActiveUserType,
		ListOrganizationsType,
		Role
	} from '$lib/auth/types';

	let {
		class: className,
		collapsible = false,
		onSelect,
		initialData
	}: {
		class?: string;
		/**
		 * Whether this copy follows the icon rail. The mobile slide-over always
		 * has room for the full layout, so it opts out.
		 */
		collapsible?: boolean;
		/** Fires when a nav entry is chosen, so the mobile slide-over can close. */
		onSelect?: () => void;
		/** Server-loaded user and organization data, so the footer never flashes empty. */
		initialData?: {
			activeUser?: GetActiveUserType;
			organizationList?: ListOrganizationsType;
			activeOrganization?: GetActiveOrganizationType;
			role?: Role;
		};
	} = $props();

	const access = getAccessContext();
	const active = getActiveCampaignContext();
	const sidebar = getSidebarContext();

	const collapsed = $derived(collapsible && sidebar.collapsed);

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

	/**
	 * Ark's `asChild` hands the trigger's own props to the element it wraps, and
	 * merges in whatever that element passes back. Typed for a `<button>`
	 * upstream, so the link widens it.
	 */
	type LinkProps = (props?: Record<string, unknown>) => Record<string, unknown>;
</script>

{#snippet navLink(item: NavItem, current: boolean, label: string, merge: LinkProps)}
	{@const Icon = item.icon}
	<a
		href={resolve(item.href)}
		aria-current={current ? 'page' : undefined}
		aria-label={label}
		data-active={current}
		{...merge({
			onclick: () => onSelect?.(),
			class: cn(
				'ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden transition-[width,padding] focus-visible:ring-2 data-[active=true]:font-medium [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
				collapsed && 'size-8 justify-center'
			)
		})}
	>
		<Icon />
		<span class={cn(collapsed && 'sr-only')}>{label}</span>
	</a>
{/snippet}

<div
	class={cn('bg-sidebar text-sidebar-foreground flex h-full w-full min-w-0 flex-col', className)}
>
	<div class={cn('flex flex-col gap-2 p-2', collapsed && 'pt-4')}>
		<CampaignSwitcher {collapsed} />
	</div>

	<nav
		class={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-auto', collapsed && 'overflow-hidden')}
		aria-label="Main"
	>
		<div class="relative flex w-full min-w-0 flex-col p-2">
			<div
				class={cn(
					'text-sidebar-foreground/70 flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium transition-[margin,opacity] duration-200 ease-linear',
					collapsed && '-mt-8 opacity-0'
				)}
			>
				{sectionLabel(inAdmin ? 'admin' : 'overview')}
			</div>

			<ul class="flex w-full min-w-0 flex-col gap-1">
				{#each items as item (item.key)}
					{@const current = isActive(item.href)}
					{@const label = item.usesObjectLabel ? active.objectLabelPlural : itemLabel(item.key)}
					<li class="group/menu-item relative">
						<!-- The label is already on screen when expanded, so the tooltip
						     switches off rather than unmounting — the link keeps its
						     identity across a collapse. -->
						<Tooltip.Root disabled={!collapsed} positioning={{ placement: 'right' }} openDelay={0}>
							<Tooltip.Trigger>
								{#snippet asChild(attrs)}
									{@render navLink(item, current, label, attrs as LinkProps)}
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>{label}</Tooltip.Content>
						</Tooltip.Root>
					</li>
				{/each}
			</ul>
		</div>
	</nav>

	<div class="flex flex-col gap-2 p-2">
		<NavUser {collapsed} {initialData} />
	</div>
</div>
