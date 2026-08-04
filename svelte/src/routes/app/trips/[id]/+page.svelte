<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { useCrumbTitle } from '$lib/shell/crumb-title.svelte';
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import * as Tabs from '$lib/primitives/ui/tabs';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';

	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import EditTripDialog from '$lib/features/trips/EditTripDialog.svelte';
	import TripAttendees from '$lib/features/trips/TripAttendees.svelte';
	import TripChecklist from '$lib/features/trips/TripChecklist.svelte';
	import TripHeader from '$lib/features/trips/TripHeader.svelte';
	import TripItinerary from '$lib/features/trips/TripItinerary.svelte';
	import TripLeaders from '$lib/features/trips/TripLeaders.svelte';
	import TripMoney from '$lib/features/trips/TripMoney.svelte';
	import TripProjects from '$lib/features/trips/TripProjects.svelte';
	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();
	const active = getActiveCampaignContext();
	const client = useConvexClient();

	const tripId = $derived(page.params.id as Id<'trips'>);

	const tripResponse = useQuery(api.trips.queries.getTrip, () =>
		auth.isAuthenticated && tripId ? { tripId } : 'skip'
	);
	const trip = $derived(tripResponse.data ?? null);
	const campaignId = $derived(trip?.campaignId ?? null);

	useCrumbTitle(() => trip?.name ?? null);

	// Trips carry no capability of their own — projects:read / projects:write
	// against the TRIP's own campaign, which is only knowable once the trip has
	// loaded. See PLAN-trips.md §9.
	const allowed = $derived(access.can('projects:read', campaignId));
	const canWrite = $derived(access.can('projects:write', campaignId));

	// The open tab lives in the URL so a block can be linked to directly, the
	// same contract the record page has.
	const TAB_VALUES = ['itinerary', 'attending', 'checklist', 'money', 'projects'];

	const activeTab = $derived.by(() => {
		const requested = page.url.searchParams.get('tab');
		// An unknown tab falls back rather than rendering an empty panel: this
		// value arrives from a hand-editable URL and a stale bookmark.
		return requested && TAB_VALUES.includes(requested) ? requested : 'itinerary';
	});

	function selectTab(value: string): void {
		if (value === activeTab) return;
		const query = value === 'itinerary' ? '' : `?tab=${value}`;
		void goto(resolve(`${page.url.pathname}${query}` as Pathname), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	let editOpen = $state(false);
	let deleteOpen = $state(false);

	async function confirmDelete(): Promise<void> {
		if (!trip) return;
		await client.mutation(api.trips.mutations.deleteTrip, { tripId: trip._id });
		await goto(resolve('/app/trips'));
	}
</script>

<PageContainer access={trip ? allowed : true} loading={tripResponse.isLoading}>
	{#snippet action()}
		{#if trip && canWrite}
			<div class="flex items-center gap-2">
				<Button variant="outline" onclick={() => (editOpen = true)}>{m.trips_edit()}</Button>
				<Button variant="ghost" onclick={() => (deleteOpen = true)}>{m.trips_delete()}</Button>
			</div>
		{/if}
	{/snippet}

	{#if !trip}
		<EmptyState title={m.trips_notFound()} />
	{:else}
		<div class="flex flex-col gap-6">
			<TripHeader {trip} />
			<TripLeaders tripId={trip._id} />

			<Tabs.Root
				value={activeTab}
				onValueChange={(details: { value: string }) => selectTab(details.value)}
				class="gap-6"
			>
				<Tabs.List>
					<Tabs.Trigger value="itinerary">{m.tripDetail_itinerary()}</Tabs.Trigger>
					<Tabs.Trigger value="attending">{m.tripDetail_attending()}</Tabs.Trigger>
					<Tabs.Trigger value="checklist">{m.tripDetail_checklist()}</Tabs.Trigger>
					<Tabs.Trigger value="money">{m.tripDetail_money()}</Tabs.Trigger>
					<Tabs.Trigger value="projects">{active.objectLabelPlural}</Tabs.Trigger>
				</Tabs.List>

				<Tabs.Content value="itinerary">
					<TripItinerary {trip} {canWrite} />
				</Tabs.Content>

				<Tabs.Content value="attending">
					<TripAttendees {trip} {canWrite} />
				</Tabs.Content>

				<Tabs.Content value="checklist">
					<TripChecklist {trip} {canWrite} />
				</Tabs.Content>

				<Tabs.Content value="money">
					<TripMoney {trip} {canWrite} />
				</Tabs.Content>

				<Tabs.Content value="projects">
					<TripProjects {trip} {canWrite} objectLabelPlural={active.objectLabelPlural} />
				</Tabs.Content>
			</Tabs.Root>
		</div>
	{/if}
</PageContainer>

{#if trip}
	<EditTripDialog bind:open={editOpen} {trip} />
	<ConfirmDialog
		bind:open={deleteOpen}
		title={m.trips_delete()}
		body={m.trips_deleteBody()}
		onConfirm={confirmDelete}
	/>
{/if}
