<script lang="ts">
	// Shell
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { useCrumbTitle } from '$lib/shell/crumb-title.svelte';
	// Access
	import { getAccessContext } from '$lib/access';
	// Primitives
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	// Feature
	import CampaignMediaCard from '$lib/features/campaigns/CampaignMediaCard.svelte';
	import CampaignEmbedCard from '$lib/features/campaigns/CampaignEmbedCard.svelte';
	import CampaignGeneralCard from '$lib/features/campaigns/CampaignGeneralCard.svelte';
	import CampaignPublicCard from '$lib/features/campaigns/CampaignPublicCard.svelte';
	import CampaignStatsCard from '$lib/features/campaigns/CampaignStatsCard.svelte';
	import UpdatesPanel from '$lib/features/updates/UpdatesPanel.svelte';
	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();

	const campaignId = $derived(page.params.id as Id<'campaigns'>);

	// The admin campaigns list is gated the same way, so this page is only ever
	// linked to from somewhere the viewer already passed this check.
	const allowed = $derived(access.can('campaign:create'));
	const canWrite = $derived(access.can('campaign:edit', campaignId));

	const campaignResponse = useQuery(api.campaigns.queries.getCampaign, () =>
		auth.isAuthenticated && allowed ? { campaignId } : 'skip'
	);
	const campaign = $derived(campaignResponse.data);

	const settingsResponse = useQuery(api.orgSettings.queries.getOrgSettings, () =>
		auth.isAuthenticated ? {} : 'skip'
	);
	const orgSlug = $derived(settingsResponse.data?.slug ?? null);

	useCrumbTitle(() => campaign?.name ?? null);
</script>

<PageContainer access={allowed} loading={campaignResponse.isLoading}>
	<div class="flex flex-col gap-4">
		<a
			href={resolve('/app/admin/campaigns')}
			class="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
		>
			<ChevronLeftIcon class="size-4" />
			{m.campaignDetail_back()}
		</a>

		{#if !campaign}
			<EmptyState title={m.campaignDetail_notFound()} />
		{:else}
			<h1 class="text-2xl font-bold tracking-tight lg:text-3xl">{campaign.name}</h1>

			<CampaignGeneralCard {campaign} {canWrite} />
			<CampaignPublicCard {campaign} {canWrite} {orgSlug} />
			<!-- The same panel the record screen mounts, with no project named, so
			these are the campaign's own posts. Writing one is `campaign:edit` here
			rather than `projects:write`, because an update is governed by the thing
			it is about. -->
			<UpdatesPanel {campaignId} />
			<CampaignStatsCard {campaign} {canWrite} />
			<CampaignMediaCard {campaign} {canWrite} />
			<CampaignEmbedCard {campaign} {orgSlug} />
		{/if}
	</div>
</PageContainer>
