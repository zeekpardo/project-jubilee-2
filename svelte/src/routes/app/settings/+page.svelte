<script lang="ts">
	// Shell
	import PageContainer from '$lib/shell/PageContainer.svelte';
	// Access
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	// Primitives
	import * as Tabs from '$lib/primitives/ui/tabs';
	import { EmptyState } from '$lib/primitives/ui/empty-state';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	// Feature
	import CampaignGeneralCard from '$lib/features/campaigns/CampaignGeneralCard.svelte';
	import CampaignPublicCard from '$lib/features/campaigns/CampaignPublicCard.svelte';
	import CampaignMediaCard from '$lib/features/campaigns/CampaignMediaCard.svelte';
	import PipelineStagesTab from '$lib/features/settings/PipelineStagesTab.svelte';
	import CostTemplatesTab from '$lib/features/settings/CostTemplatesTab.svelte';
	import TaskTemplatesTab from '$lib/features/settings/TaskTemplatesTab.svelte';
	import CustomFieldsTab from '$lib/features/settings/CustomFieldsTab.svelte';
	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();
	const active = getActiveCampaignContext();

	// settings:manage is org-wide: a team leader never reaches this page, however
	// many campaigns they are assigned to.
	const allowed = $derived(access.can('settings:manage'));
	const campaignId = $derived(active.id as Id<'campaigns'> | null);

	// campaign:edit is campaign-scoped — the same gate the admin campaigns
	// route uses for these same cards.
	const canWrite = $derived(campaignId ? access.can('campaign:edit', campaignId) : false);

	const campaignResponse = useQuery(api.campaigns.queries.getCampaign, () =>
		auth.isAuthenticated && campaignId ? { campaignId } : 'skip'
	);
	const campaign = $derived(campaignResponse.data);

	const settingsResponse = useQuery(api.orgSettings.queries.getOrgSettings, () =>
		auth.isAuthenticated ? {} : 'skip'
	);
	const orgSlug = $derived(settingsResponse.data?.slug ?? null);

	const TABS = [
		{ value: 'campaign', label: () => m.settings_campaign() },
		{ value: 'publicSite', label: () => m.settings_publicSite() },
		{ value: 'pipeline', label: () => m.settings_pipeline() },
		{ value: 'costTemplates', label: () => m.settings_costTemplates() },
		{ value: 'taskTemplates', label: () => m.settings_taskTemplates() },
		{ value: 'customFields', label: () => m.settings_customFields() }
	] as const;
</script>

<PageContainer
	title={m.settings_title()}
	description={m.settings_subtitle()}
	access={allowed}
	loading={campaignResponse.isLoading}
>
	{#if campaignId}
		<Tabs.Root value="campaign" class="gap-6">
			<Tabs.List>
				{#each TABS as tab (tab.value)}
					<Tabs.Trigger value={tab.value}>{tab.label()}</Tabs.Trigger>
				{/each}
			</Tabs.List>

			<Tabs.Content value="campaign">
				{#if campaign}
					<CampaignGeneralCard {campaign} {canWrite} />
				{/if}
			</Tabs.Content>
			<Tabs.Content value="publicSite">
				{#if campaign}
					<div class="flex flex-col gap-6">
						<CampaignPublicCard {campaign} {canWrite} {orgSlug} />
						<CampaignMediaCard {campaign} {canWrite} />
					</div>
				{/if}
			</Tabs.Content>
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
