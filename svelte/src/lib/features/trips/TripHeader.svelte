<script lang="ts">
	// Name, dates, destination, status — the top block of §11.

	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';

	import type { Doc } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';
	import { formatTripDateRange } from './format';
	import { tripStatusLabel, tripStatusVariant } from './labels';

	let { trip }: { trip: Doc<'trips'> } = $props();
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="text-2xl">{trip.name}</Card.Title>
		{#if trip.summary}
			<Card.Description>{trip.summary}</Card.Description>
		{/if}
		<Card.Action>
			<Badge variant={tripStatusVariant(trip.status)}>{tripStatusLabel(trip.status)}</Badge>
		</Card.Action>
	</Card.Header>
	<Card.Content>
		<dl class="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
			<div class="flex items-center gap-2">
				<CalendarIcon class="size-4" aria-hidden="true" />
				<dt class="sr-only">{m.trips_dates()}</dt>
				<dd class="tabular-nums">{formatTripDateRange(trip.startOn, trip.endOn)}</dd>
			</div>
			<div class="flex items-center gap-2">
				<MapPinIcon class="size-4" aria-hidden="true" />
				<dt class="sr-only">{m.trips_destination()}</dt>
				<dd>
					{trip.destination}{#if trip.countryCode}&nbsp;({trip.countryCode}){/if}
				</dd>
			</div>
		</dl>

		{#if trip.notes}
			<p class="mt-4 text-sm whitespace-pre-line">{trip.notes}</p>
		{/if}
	</Card.Content>
</Card.Root>
