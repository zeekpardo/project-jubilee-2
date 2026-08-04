<script lang="ts">
	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { Can, getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import NewTripDialog from '$lib/features/trips/NewTripDialog.svelte';
	import TripsBrowser from '$lib/features/trips/TripsBrowser.svelte';
	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	const access = getAccessContext();
	const active = getActiveCampaignContext();

	const campaignId = $derived(active.id as Id<'campaigns'> | null);
	// Trips carry no capability of their own — they are campaign operational
	// work, gated on projects:read / projects:write against the trip's own
	// campaign. See PLAN-trips.md §9.
	const allowed = $derived(access.can('projects:read', active.id));
</script>

<PageContainer title={m.trips_title()} description={m.trips_subtitle()} access={allowed}>
	{#snippet action()}
		{#if allowed && campaignId}
			<Can do="projects:write" campaignId={active.id}>
				<NewTripDialog
					{campaignId}
					campaignName={active.current?.name ?? ''}
					objectLabel={active.objectLabel}
				/>
			</Can>
		{/if}
	{/snippet}

	{#if campaignId}
		<TripsBrowser {campaignId} />
	{:else}
		<EmptyState
			title={access.isAssignedRole ? m.access_noCampaignsTitle() : m.shell_noCampaigns()}
			description={access.isAssignedRole ? m.access_noCampaignsBody() : undefined}
		/>
	{/if}
</PageContainer>
