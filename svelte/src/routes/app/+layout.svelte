<script lang="ts">
	import { useAccess, setAccessContext } from '$lib/access';
	import {
		createActiveCampaign,
		setActiveCampaignContext,
		type CampaignSummary
	} from '$lib/campaigns/active.svelte';
	import { createSidebarState, setSidebarContext } from '$lib/shell/sidebar.svelte';
	import { createCrumbTitle, setCrumbTitleContext } from '$lib/shell/crumb-title.svelte';
	import AppSidebar from '$lib/shell/AppSidebar.svelte';
	import AppBreadcrumbs from '$lib/shell/AppBreadcrumbs.svelte';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Button } from '$lib/primitives/ui/button';
	import { Separator } from '$lib/primitives/ui/separator';
	import * as Drawer from '$lib/primitives/ui/drawer';
	import { cn } from '$lib/primitives/utils';
	import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
	import * as m from '$lib/i18n/messages';

	let { data, children } = $props();

	const access = useAccess(() => ({ initialData: data.access }));
	setAccessContext(access);

	const activeCampaign = createActiveCampaign(
		() => (data.campaigns ?? []) as CampaignSummary[],
		() => data.activeCampaignId ?? null
	);
	setActiveCampaignContext(activeCampaign);

	// Starts from the cookie the server read, so the column is already the right
	// width when the first paint happens.
	const sidebar = createSidebarState(() => data.sidebarOpen ?? true);
	setSidebarContext(sidebar);

	setCrumbTitleContext(createCrumbTitle());

	// The sidebar is a fixed column on desktop and a slide-over on mobile; the
	// same nav renders in both.
	let navOpen = $state(false);

	/** One control for both layouts: the drawer on mobile, the rail on desktop. */
	function toggleSidebar() {
		if (sidebar.isMobile) navOpen = !navOpen;
		else sidebar.toggle();
	}

	function isTyping(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		return (
			target.isContentEditable ||
			target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.tagName === 'SELECT'
		);
	}

	$effect(() => {
		function onKeydown(event: KeyboardEvent) {
			if (event.key !== 'b' && event.key !== 'B') return;
			if (!event.metaKey && !event.ctrlKey) return;
			// Cmd+B is bold in any editor; leave it alone while the user types.
			if (isTyping(event.target)) return;
			event.preventDefault();
			toggleSidebar();
		}

		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

{#if !access.canAccessAdmin}
	<div class="flex min-h-[60vh] items-center justify-center p-8">
		<EmptyState title={m.access_deniedTitle()} description={m.access_deniedBody()} />
	</div>
{:else}
	<div class="flex min-h-svh w-full">
		<aside
			class={cn(
				'border-border bg-sidebar sticky top-0 hidden h-svh shrink-0 border-r transition-[width] duration-200 ease-linear md:block',
				sidebar.collapsed ? 'w-sidebar-icon' : 'w-sidebar'
			)}
		>
			<AppSidebar collapsible initialData={data.initialData} />
		</aside>

		<!-- Mounted only while open so the desktop column stays the single live
		     copy of the switcher. The slide-over has room for the full layout, so
		     it never collapses. -->
		<Drawer.Root bind:open={navOpen} lazyMount unmountOnExit>
			<Drawer.Content
				side="left"
				class="bg-sidebar text-sidebar-foreground w-72 gap-0 p-0 sm:max-w-72"
			>
				<Drawer.Title class="sr-only p-0">{m.shell_navigation()}</Drawer.Title>
				<AppSidebar onSelect={() => (navOpen = false)} initialData={data.initialData} />
			</Drawer.Content>
		</Drawer.Root>

		<div class="bg-background relative flex w-full min-w-0 flex-1 flex-col">
			<header
				class="bg-background/60 sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 backdrop-blur-md md:h-14"
			>
				<div class="flex min-w-0 flex-1 items-center gap-2 px-4">
					<Button
						variant="ghost"
						size="icon"
						class="-ml-1 size-7"
						aria-label={m.shell_toggleSidebar()}
						aria-expanded={sidebar.isMobile ? navOpen : sidebar.open}
						onclick={toggleSidebar}
					>
						<PanelLeftIcon />
					</Button>
					<Separator orientation="vertical" class="mr-2 h-4" />
					<AppBreadcrumbs />
				</div>
			</header>

			<main class="flex min-w-0 flex-1 flex-col">
				{@render children?.()}
			</main>
		</div>
	</div>
{/if}
