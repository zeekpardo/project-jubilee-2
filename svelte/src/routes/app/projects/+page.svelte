<script lang="ts">
	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { Can, getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import NewProjectDialog from '$lib/features/projects/NewProjectDialog.svelte';
	import ProjectsBrowser from '$lib/features/projects/ProjectsBrowser.svelte';
	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	const access = getAccessContext();
	const active = getActiveCampaignContext();

	const campaignId = $derived(active.id as Id<'campaigns'> | null);
	const allowed = $derived(access.can('projects:read', active.id));
</script>

<PageContainer title={active.objectLabelPlural} access={allowed}>
	{#snippet action()}
		{#if allowed && campaignId}
			<Can do="projects:write" campaignId={active.id}>
				<NewProjectDialog {campaignId} objectLabel={active.objectLabel} />
			</Can>
		{/if}
	{/snippet}

	{#if campaignId}
		<ProjectsBrowser {campaignId} />
	{:else}
		<EmptyState
			title={access.isTeamLeader ? m.access_noCampaignsTitle() : m.shell_noCampaigns()}
			description={access.isTeamLeader ? m.access_noCampaignsBody() : undefined}
		/>
	{/if}
</PageContainer>
