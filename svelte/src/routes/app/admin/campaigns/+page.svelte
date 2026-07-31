<script lang="ts">
	// Shell
	import PageContainer from '$lib/shell/PageContainer.svelte';
	// Access
	import { getAccessContext, Can } from '$lib/access';
	// Primitives
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	// Feature
	import CampaignsTable from '$lib/features/campaigns/CampaignsTable.svelte';
	import CampaignFormDialog from '$lib/features/campaigns/CampaignFormDialog.svelte';
	import DeleteCampaignDialog from '$lib/features/campaigns/DeleteCampaignDialog.svelte';
	import type { Campaign } from '$lib/features/campaigns/types';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const access = getAccessContext();
	const auth = useAuth();

	const allowed = $derived(access.can('campaign:create'));

	const campaignsResponse = useQuery(api.campaigns.queries.listCampaigns, () =>
		auth.isAuthenticated && allowed ? {} : 'skip'
	);
	const campaigns = $derived((campaignsResponse.data ?? []) as Campaign[]);
	const isLoading = $derived(campaignsResponse.isLoading);

	let formOpen = $state(false);
	let deleteOpen = $state(false);
	let editing = $state<Campaign | null>(null);
	let deleting = $state<Campaign | null>(null);

	function openCreate(): void {
		editing = null;
		formOpen = true;
	}

	function openEdit(campaign: Campaign): void {
		editing = campaign;
		formOpen = true;
	}

	function openDelete(campaign: Campaign): void {
		deleting = campaign;
		deleteOpen = true;
	}
</script>

<PageContainer
	title={m.campaigns_title()}
	description={m.campaigns_subtitle()}
	access={allowed}
	loading={isLoading}
>
	{#snippet action()}
		<Can do="campaign:create">
			<Button onclick={openCreate}>
				<PlusIcon />
				{m.campaigns_new()}
			</Button>
		</Can>
	{/snippet}

	{#if campaigns.length === 0}
		<EmptyState title={m.campaigns_empty()} description={m.campaigns_emptyBody()}>
			{#snippet icon()}
				<MegaphoneIcon />
			{/snippet}
			{#snippet action()}
				<Can do="campaign:create">
					<Button onclick={openCreate}>
						<PlusIcon />
						{m.campaigns_new()}
					</Button>
				</Can>
			{/snippet}
		</EmptyState>
	{:else}
		<CampaignsTable {campaigns} onEdit={openEdit} onDelete={openDelete} />
	{/if}
</PageContainer>

<CampaignFormDialog bind:open={formOpen} campaign={editing} />
<DeleteCampaignDialog bind:open={deleteOpen} campaign={deleting} />
