<script lang="ts">
	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import TaskListView from '$lib/features/tasks/TaskListView.svelte';
	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	const access = getAccessContext();
	// READ-ONLY here. Switching campaigns must not clear the user's filters, and
	// filtering must not change the active campaign, so nothing on this page
	// writes back to the context.
	const active = getActiveCampaignContext();

	const campaignId = $derived(active.id as Id<'campaigns'> | null);
	const allowed = $derived(access.can('projects:read', active.id));
</script>

<PageContainer title={m.taskList_title()} description={m.taskList_subtitle()} access={allowed}>
	{#if campaignId}
		<TaskListView scope="campaign" {campaignId} />
	{:else}
		<EmptyState
			title={access.isAssignedRole ? m.access_noCampaignsTitle() : m.shell_noCampaigns()}
			description={access.isAssignedRole ? m.access_noCampaignsBody() : undefined}
		/>
	{/if}
</PageContainer>
