<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	import * as Menu from '$lib/primitives/ui/menu';
	import { cn } from '$lib/primitives/utils';
	import * as m from '$lib/i18n/messages';
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { ADMIN_ROOT, isAdminPath } from './nav-config';

	import LockIcon from '@lucide/svelte/icons/lock';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';

	let { class: className }: { class?: string } = $props();

	const access = getAccessContext();
	const active = getActiveCampaignContext();

	// Admin is a distinct mode. While in it the trigger reads "Admin", but the
	// active campaign is kept underneath for when you come back.
	const inAdmin = $derived(isAdminPath(page.url.pathname));

	// The admin entry only appears for someone who has an org-wide reason to
	// use it; a team leader has none.
	const canSeeAdmin = $derived(
		access.can('campaign:create') || access.can('members:manage') || access.can('org:manage')
	);

	function enterAdmin() {
		void goto(resolve(ADMIN_ROOT));
	}

	function selectCampaign(id: string) {
		active.select(id);
		// Coming from admin, land back in the campaign workspace.
		if (inAdmin) void goto(resolve('/app'));
	}
</script>

<Menu.Root>
	<Menu.Trigger
		class={cn(
			'hover:bg-muted/60 flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-sm',
			className
		)}
	>
		<span
			class="bg-sidebar-primary text-sidebar-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-md"
		>
			{#if inAdmin}
				<LockIcon class="size-4" />
			{:else}
				<SparklesIcon class="size-4" />
			{/if}
		</span>
		<span class="min-w-0 flex-1 truncate font-medium">
			{inAdmin ? m.nav_section_admin() : (active.current?.name ?? m.shell_selectCampaign())}
		</span>
		<ChevronsUpDownIcon class="text-muted-foreground size-4 shrink-0" />
	</Menu.Trigger>

	<Menu.Content class="w-56">
		{#if canSeeAdmin}
			<Menu.ItemGroup>
				<Menu.Item value="__admin" onclick={enterAdmin}>
					<LockIcon class="size-4" />
					<span>{m.nav_section_admin()}</span>
				</Menu.Item>
			</Menu.ItemGroup>
			<Menu.Separator />
		{/if}

		<Menu.ItemGroup>
			<Menu.ItemGroupLabel>{m.shell_campaign()}</Menu.ItemGroupLabel>
			{#each active.campaigns as campaign (campaign._id)}
				<Menu.Item value={campaign._id} onclick={() => selectCampaign(campaign._id)}>
					<SparklesIcon class="size-4" />
					<span class="truncate">{campaign.name}</span>
				</Menu.Item>
			{/each}
			{#if active.campaigns.length === 0}
				<p class="text-muted-foreground px-2 py-1.5 text-sm">{m.shell_noCampaigns()}</p>
			{/if}
		</Menu.ItemGroup>
	</Menu.Content>
</Menu.Root>
