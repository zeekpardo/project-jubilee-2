<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import { formatTripDateRange } from './format';
	import { tripStatusLabel, tripStatusVariant } from './labels';
	import type { TripRow } from './types';

	let { trip }: { trip: TripRow } = $props();

	const { api } = getAuthContext();

	// The roster count is a per-row read, because `listTrips` returns trip
	// documents and nothing on the trip carries a count. One subscription per
	// row is affordable here and only here: a campaign's trip list is tens of
	// rows, not the unbounded page a contacts or tasks list can be. The same
	// shape `ProjectRow` uses for its money figures.
	const attendeesResponse = useQuery(api.tripAttendees.queries.listTripAttendees, () => ({
		tripId: trip._id
	}));
	const attendeeCount = $derived(attendeesResponse.data?.length ?? null);
</script>

<Table.Row>
	<Table.Cell class="font-medium">
		<a class="hover:underline" href={resolve('/app/trips/[id]', { id: trip._id })}>
			{trip.name}
		</a>
	</Table.Cell>
	<Table.Cell class="whitespace-nowrap tabular-nums">
		{formatTripDateRange(trip.startOn, trip.endOn)}
	</Table.Cell>
	<Table.Cell>{trip.destination}</Table.Cell>
	<Table.Cell>
		<Badge variant={tripStatusVariant(trip.status)}>{tripStatusLabel(trip.status)}</Badge>
	</Table.Cell>
	<Table.Cell class="text-right tabular-nums">
		{#if attendeeCount === null}
			<span class="text-muted-foreground" aria-hidden="true">—</span>
		{:else}
			{attendeeCount}
		{/if}
	</Table.Cell>
</Table.Row>
