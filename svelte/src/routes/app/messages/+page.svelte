<script lang="ts">
	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';

	import { getAccessContext } from '$lib/access';
	import Can from '$lib/access/Can.svelte';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';
	import CheckinsInbox from '$lib/features/checkins/CheckinsInbox.svelte';
	import NewMessageDialog from '$lib/features/checkins/NewMessageDialog.svelte';

	const access = getAccessContext();
	const active = getActiveCampaignContext();

	const campaignId = $derived(active.id as Id<'campaigns'> | null);
	const allowed = $derived(access.can('projects:read', active.id));
</script>

<PageContainer
	title={m.messages_title()}
	description={m.messages_subtitle()}
	access={allowed}
	class="min-h-0"
>
	{#snippet action()}
		<!-- The dialog IS the action button, the same shape NewTripDialog has on
		     the trips list. Starting a conversation has to be reachable from the
		     place conversations are read — burying it on a record's own page was
		     the reason it could not be found. -->
		{#if allowed && campaignId}
			<Can do="projects:write" campaignId={active.id}>
				<NewMessageDialog {campaignId} />
			</Can>
		{/if}
	{/snippet}

	{#if campaignId}
		<CheckinsInbox {campaignId} />
	{:else}
		<EmptyState title={m.messages_empty()} description={m.messages_emptyBody()}>
			{#snippet icon()}<MessagesSquareIcon />{/snippet}
		</EmptyState>
	{/if}
</PageContainer>
