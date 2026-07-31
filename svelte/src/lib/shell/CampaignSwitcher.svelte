<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	import { Portal } from '@ark-ui/svelte';
	import * as Menu from '$lib/primitives/ui/menu';
	import { Input } from '$lib/primitives/ui/input';
	import { cn } from '$lib/primitives/utils';
	import * as m from '$lib/i18n/messages';
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { ADMIN_ROOT, isAdminPath } from './nav-config';

	import LockIcon from '@lucide/svelte/icons/lock';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';

	let {
		class: className,
		collapsed = false
	}: {
		class?: string;
		/** On the icon rail only the tile survives; the label and chevron fade out. */
		collapsed?: boolean;
	} = $props();

	const access = getAccessContext();
	const active = getActiveCampaignContext();

	// Admin is a distinct mode. While in it the trigger reads "Admin", but the
	// active campaign is kept underneath for when you come back.
	const inAdmin = $derived(isAdminPath(page.url.pathname));

	const triggerName = $derived(
		inAdmin ? m.nav_section_admin() : (active.current?.name ?? m.shell_selectCampaign())
	);

	// The admin entry only appears for someone who has an org-wide reason to
	// use it; a team leader has none.
	const canSeeAdmin = $derived(
		access.can('campaign:create') || access.can('members:manage') || access.can('org:manage')
	);

	let query = $state('');

	const matches = $derived(
		active.campaigns.filter((campaign) =>
			campaign.name.toLowerCase().includes(query.trim().toLowerCase())
		)
	);

	// The menu opens beside the sidebar on desktop and under the trigger inside
	// the mobile slide-over, where there is no room to its right.
	let wide = $state(true);
	$effect(() => {
		const media = window.matchMedia('(min-width: 768px)');
		const sync = () => (wide = media.matches);
		sync();
		media.addEventListener('change', sync);
		return () => media.removeEventListener('change', sync);
	});

	function enterAdmin() {
		void goto(resolve(ADMIN_ROOT));
	}

	function selectCampaign(id: string) {
		active.select(id);
		// Coming from admin, land back in the campaign workspace.
		if (inAdmin) void goto(resolve('/app'));
	}
</script>

<Menu.Root
	positioning={{ placement: wide ? 'right-start' : 'bottom-start', gutter: 4 }}
	onOpenChange={(details) => {
		if (!details.open) query = '';
	}}
>
	<Menu.Trigger
		class={cn(
			'ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground flex h-12 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden focus-visible:ring-2',
			collapsed && 'justify-center gap-0 p-0',
			className
		)}
		aria-label={collapsed ? triggerName : undefined}
	>
		<span
			class="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg"
		>
			{#if inAdmin}
				<LockIcon class="size-4" />
			{:else}
				<SparklesIcon class="size-4" />
			{/if}
		</span>
		<span
			class={cn(
				'grid flex-1 text-left text-xs leading-tight transition-all duration-200 ease-in-out',
				collapsed ? 'invisible max-w-0 overflow-hidden opacity-0' : 'visible max-w-full opacity-100'
			)}
		>
			<span class="truncate font-medium">{triggerName}</span>
			<span class="text-muted-foreground truncate text-[11px]">
				{inAdmin ? m.shell_organizationWide() : active.objectLabelPlural}
			</span>
		</span>
		<ChevronsUpDownIcon
			class={cn(
				'ml-auto size-4 shrink-0 transition-all duration-200 ease-in-out',
				collapsed ? 'invisible max-w-0 overflow-hidden opacity-0' : 'visible max-w-full opacity-100'
			)}
		/>
	</Menu.Trigger>

	<Portal>
		<Menu.Content class="w-(--reference-width) min-w-56 rounded-lg">
			{#if canSeeAdmin}
				<Menu.ItemGroup>
					<Menu.Item value="__admin" class="h-auto gap-2 p-2" onclick={enterAdmin}>
						<span class="flex size-6 items-center justify-center rounded-md border bg-transparent">
							<LockIcon class="size-3.5" />
						</span>
						<span class="flex-1 text-xs font-medium">{m.nav_section_admin()}</span>
						{#if inAdmin}
							<CheckIcon class="ml-auto size-4" />
						{/if}
					</Menu.Item>
				</Menu.ItemGroup>
				<Menu.Separator />
			{/if}

			<Menu.Label class="text-muted-foreground text-xs">{m.nav_campaigns()}</Menu.Label>

			<!-- The menu's own typeahead would swallow these keystrokes, so the
			     search box keeps them to itself. -->
			<div class="px-1 pb-1">
				<Input
					bind:value={query}
					class="h-8 text-sm"
					placeholder={m.shell_searchCampaigns()}
					onkeydown={(event) => event.stopPropagation()}
				/>
			</div>

			<div class="max-h-64 overflow-y-auto">
				{#if matches.length === 0}
					<p class="text-muted-foreground px-2 py-4 text-center text-xs">
						{m.shell_noCampaigns()}
					</p>
				{:else}
					<Menu.ItemGroup>
						{#each matches as campaign (campaign._id)}
							<Menu.Item
								value={campaign._id}
								class="h-auto gap-2 p-2"
								onclick={() => selectCampaign(campaign._id)}
							>
								<span
									class="flex size-6 items-center justify-center overflow-hidden rounded-md border"
								>
									<SparklesIcon class="size-3.5" />
								</span>
								<span class="grid flex-1 text-left leading-tight">
									<span class="truncate text-xs">{campaign.name}</span>
									<span class="text-muted-foreground truncate text-[11px]">
										{campaign.objectLabelPlural}
									</span>
								</span>
								{#if !inAdmin && campaign._id === active.id}
									<CheckIcon class="ml-auto size-4" />
								{/if}
							</Menu.Item>
						{/each}
					</Menu.ItemGroup>
				{/if}
			</div>
		</Menu.Content>
	</Portal>
</Menu.Root>
