<script lang="ts">
	// The working trip list, filtered by campaign.
	//
	// NOT re-sorted here. `listTrips` reads `by_campaignId_and_startOn`, and
	// ascending startOn IS soonest first — a second sort in the component would
	// be a second opinion about the same order, and the two would only ever
	// disagree by accident.

	// Primitives
	import * as Select from '$lib/primitives/ui/select';
	import * as Table from '$lib/primitives/ui/table';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { createListCollection } from '@ark-ui/svelte/select';
	import PlaneIcon from '@lucide/svelte/icons/plane';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';
	import { TRIP_STATUSES, tripStatusLabel, type TripStatus } from './labels';
	import TripRow from './TripRow.svelte';

	let { campaignId }: { campaignId: Id<'campaigns'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();

	const ALL_STATUSES = 'all';

	let statusFilter = $state<TripStatus | typeof ALL_STATUSES>(ALL_STATUSES);

	const tripsResponse = useQuery(api.trips.queries.listTrips, () =>
		auth.isAuthenticated
			? {
					campaignId,
					...(statusFilter === ALL_STATUSES ? {} : { status: statusFilter })
				}
			: 'skip'
	);
	const trips = $derived(tripsResponse.data ?? []);

	const statusCollection = createListCollection({
		items: [
			{ value: ALL_STATUSES, label: m.trips_allStatuses() },
			...TRIP_STATUSES.map((value) => ({ value, label: tripStatusLabel(value) }))
		]
	});
</script>

<div class="flex flex-col gap-4">
	<div
		role="toolbar"
		aria-orientation="horizontal"
		class="flex w-full items-start justify-between gap-2 p-1"
	>
		<Select.Root
			collection={statusCollection}
			value={[statusFilter]}
			onValueChange={(details: { value: string[] }): void => {
				statusFilter = (details.value[0] as TripStatus | typeof ALL_STATUSES) ?? ALL_STATUSES;
			}}
		>
			<Select.Label class="sr-only">{m.field_status()}</Select.Label>
			<Select.Trigger size="sm" class="w-44" placeholder={m.trips_allStatuses()} />
			<Select.Content>
				{#each statusCollection.items as option (option.value)}
					<Select.Item item={option}>
						<Select.ItemText>{option.label}</Select.ItemText>
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	{#if tripsResponse.isLoading}
		<div class="flex flex-col gap-3">
			<Skeleton class="h-10 w-full" />
			<Skeleton class="h-10 w-full" />
			<Skeleton class="h-10 w-full" />
		</div>
	{:else if trips.length === 0}
		<EmptyState
			title={statusFilter === ALL_STATUSES ? m.trips_empty() : m.list_noResults()}
			description={statusFilter === ALL_STATUSES ? m.trips_emptyBody() : undefined}
		>
			{#snippet icon()}
				<PlaneIcon />
			{/snippet}
		</EmptyState>
	{:else}
		<div class="overflow-hidden rounded-lg border">
			<Table.Root>
				<Table.Header class="bg-muted">
					<Table.Row>
						<Table.Head>{m.field_name()}</Table.Head>
						<Table.Head>{m.trips_dates()}</Table.Head>
						<Table.Head>{m.trips_destination()}</Table.Head>
						<Table.Head>{m.field_status()}</Table.Head>
						<Table.Head class="text-right">{m.trips_attendees()}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each trips as trip (trip._id)}
						<TripRow {trip} />
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</div>
