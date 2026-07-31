<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import { Button } from '$lib/primitives/ui/button';
	import { Checkbox } from '$lib/primitives/ui/checkbox';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { toast } from 'svelte-sonner';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import type { Campaign } from '$lib/features/campaigns/types';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const client = useConvexClient();

	let {
		open = $bindable(false),
		userId,
		memberName,
		campaigns,
		assignedCampaignIds
	}: {
		open?: boolean;
		userId: string | null;
		memberName: string;
		campaigns: Campaign[];
		assignedCampaignIds: string[];
	} = $props();

	let selected = $state<string[]>([]);
	let isSaving = $state(false);

	// Re-seed on open so a cancelled edit never carries into the next member.
	$effect(() => {
		if (!open) return;
		selected = [...assignedCampaignIds];
	});

	function toggle(campaignId: string, checked: boolean): void {
		selected = checked ? [...selected, campaignId] : selected.filter((id) => id !== campaignId);
	}

	async function handleSave(): Promise<void> {
		if (!userId || isSaving) return;
		isSaving = true;
		try {
			await client.mutation(api.access.mutations.setCampaignAssignments, {
				userId,
				campaignIds: campaigns.filter((c) => selected.includes(c._id)).map((c) => c._id)
			});
			toast.success(m.members_assignmentsUpdated());
			open = false;
		} catch (error: unknown) {
			toast.error(error instanceof Error ? error.message : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-lg">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.members_assignedCampaigns()}</Dialog.Title>
			<Dialog.Description>{memberName}</Dialog.Description>
		</Dialog.Header>

		<p class="text-muted-foreground w-full text-sm">{m.members_assignHelp()}</p>

		{#if campaigns.length === 0}
			<EmptyState
				class="w-full"
				title={m.campaigns_empty()}
				description={m.campaigns_emptyBody()}
			/>
		{:else}
			<div class="flex w-full flex-col gap-3">
				{#each campaigns as campaign (campaign._id)}
					<Checkbox
						checked={selected.includes(campaign._id)}
						onCheckedChange={(details) => toggle(campaign._id, details.checked === true)}
					>
						{campaign.name}
					</Checkbox>
				{/each}
			</div>
		{/if}

		<Dialog.Footer class="w-full">
			<Button variant="outline" onclick={() => (open = false)} disabled={isSaving}>
				{m.action_cancel()}
			</Button>
			<Button loading={isSaving} disabled={isSaving || campaigns.length === 0} onclick={handleSave}>
				{m.action_save()}
			</Button>
		</Dialog.Footer>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
