<script lang="ts">
	// Shell
	import PageContainer from '$lib/shell/PageContainer.svelte';
	// Access
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	// Primitives
	import * as Tabs from '$lib/primitives/ui/tabs';
	import { EmptyState } from '$lib/primitives/ui/empty-state';

	// Feature
	import PipelineStagesTab from '$lib/features/settings/PipelineStagesTab.svelte';
	import CostTemplatesTab from '$lib/features/settings/CostTemplatesTab.svelte';
	import TaskTemplatesTab from '$lib/features/settings/TaskTemplatesTab.svelte';
	import CustomFieldsTab from '$lib/features/settings/CustomFieldsTab.svelte';
	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	const access = getAccessContext();
	const active = getActiveCampaignContext();

	// settings:manage is org-wide: a team leader never reaches this page, however
	// many campaigns they are assigned to.
	const allowed = $derived(access.can('settings:manage'));
	const campaignId = $derived(active.id as Id<'campaigns'> | null);

	const TABS = [
		{ value: 'pipeline', label: () => m.settings_pipeline() },
		{ value: 'costTemplates', label: () => m.settings_costTemplates() },
		{ value: 'taskTemplates', label: () => m.settings_taskTemplates() },
		{ value: 'customFields', label: () => m.settings_customFields() }
	] as const;
</script>

<PageContainer title={m.settings_title()} description={m.settings_subtitle()} access={allowed}>
	{#if campaignId}
		<Tabs.Root value="pipeline" class="gap-6">
			<Tabs.List>
				{#each TABS as tab (tab.value)}
					<Tabs.Trigger value={tab.value}>{tab.label()}</Tabs.Trigger>
				{/each}
			</Tabs.List>

			<Tabs.Content value="pipeline">
				<PipelineStagesTab {campaignId} />
			</Tabs.Content>
			<Tabs.Content value="costTemplates">
				<CostTemplatesTab {campaignId} />
			</Tabs.Content>
			<Tabs.Content value="taskTemplates">
				<TaskTemplatesTab {campaignId} />
			</Tabs.Content>
			<Tabs.Content value="customFields">
				<CustomFieldsTab {campaignId} />
			</Tabs.Content>
		</Tabs.Root>
	{:else}
		<EmptyState title={m.shell_noCampaigns()} />
	{/if}
</PageContainer>
