<script lang="ts">
	// The itinerary: outbound legs, return legs, and per-person deviations folded
	// under their traveller.
	//
	// EVERY TIME ON THIS SCREEN IS RENDERED VERBATIM through the wall-clock
	// formatters in `lib/domain/trip-itinerary.ts`. Nothing here calls `new Date()`
	// on a stored value — that would reinterpret a boarding-pass time in the
	// VIEWER's zone, so a coordinator in Tulsa would read a departure that appears
	// nowhere on the ticket.
	//
	// Durations come from the same module and are shown ONLY when it returns a
	// number. A leg whose IANA zone is missing simply has no duration; the block
	// says why once, rather than printing a guess or a NaN.

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlaneIcon from '@lucide/svelte/icons/plane';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc, Id } from '$convex/_generated/dataModel';

	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import {
		formatDurationMinutes,
		formatWallClockDateTime,
		formatWallClockTime,
		summarizeDirection,
		type DirectionSummary,
		type LegTiming
	} from '$lib/domain/trip-itinerary';
	import * as m from '$lib/i18n/messages';
	import { formatFlightLabel, formatLegRoute } from './format';
	import { TRIP_DIRECTIONS, tripDirectionLabel, type TripDirection } from './labels';
	import TripSegmentDialog from './TripSegmentDialog.svelte';
	import type { TripSegmentRow } from './types';

	let { trip, canWrite }: { trip: Doc<'trips'>; canWrite: boolean } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const segmentsResponse = useQuery(api.tripSegments.queries.listTripSegments, () => ({
		tripId: trip._id
	}));
	const segments = $derived(segmentsResponse.data ?? []);

	const attendeesResponse = useQuery(api.tripAttendees.queries.listTripAttendees, () => ({
		tripId: trip._id
	}));
	const attendees = $derived(attendeesResponse.data ?? []);

	// Absent attendeeId is the group itinerary; present is one person's own leg.
	const groupLegs = $derived(segments.filter((leg) => leg.attendeeId === undefined));

	/**
	 * Travellers who fly something of their own, in roster order (leaders first).
	 *
	 * A plain record rather than a Map: this is scratch working rebuilt on every
	 * recompute, not reactive state.
	 */
	const personal = $derived.by(() => {
		const byAttendee: Record<string, TripSegmentRow[]> = {};
		for (const flight of segments) {
			if (!flight.attendeeId) continue;
			const key = flight.attendeeId as string;
			const bucket = byAttendee[key];
			if (bucket) bucket.push(flight);
			else byAttendee[key] = [flight];
		}
		return attendees
			.map((attendee) => ({
				attendee,
				legs: byAttendee[attendee._id as string] ?? []
			}))
			.filter((entry) => entry.legs.length > 0);
	});

	/** One summary per direction that actually has legs. */
	function directionsOf(
		legs: TripSegmentRow[]
	): { direction: TripDirection; summary: DirectionSummary<TripSegmentRow> }[] {
		return TRIP_DIRECTIONS.map((direction) => ({
			direction,
			summary: summarizeDirection(legs.filter((leg) => leg.direction === direction))
		})).filter((entry) => entry.summary.legs.length > 0);
	}

	let dialogOpen = $state(false);
	let editing = $state<TripSegmentRow | null>(null);
	let dialogAttendeeId = $state<Id<'tripAttendees'> | null>(null);

	let removeOpen = $state(false);
	let removing = $state<TripSegmentRow | null>(null);

	function openAdd(attendeeId: Id<'tripAttendees'> | null): void {
		editing = null;
		dialogAttendeeId = attendeeId;
		dialogOpen = true;
	}

	function openEdit(segment: TripSegmentRow): void {
		editing = segment;
		dialogAttendeeId = segment.attendeeId ?? null;
		dialogOpen = true;
	}

	function openRemove(segment: TripSegmentRow): void {
		removing = segment;
		removeOpen = true;
	}

	async function removeSegment(): Promise<void> {
		const target = removing;
		if (!target) return;
		await client.mutation(api.tripSegments.mutations.removeTripSegment, { segmentId: target._id });
	}
</script>

{#snippet leg(timing: LegTiming<TripSegmentRow>)}
	{#if timing.layoverBeforeMinutes !== null}
		<li class="text-muted-foreground ps-1 text-xs">
			{m.tripDetail_layover({ duration: formatDurationMinutes(timing.layoverBeforeMinutes) })}
		</li>
	{/if}
	<li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border px-3 py-2">
		<span class="font-medium">
			{formatFlightLabel(timing.leg.airline, timing.leg.flightNumber)}
		</span>
		{#if formatLegRoute(timing.leg.departureAirport, timing.leg.arrivalAirport)}
			<span class="text-muted-foreground font-mono text-xs">
				{formatLegRoute(timing.leg.departureAirport, timing.leg.arrivalAirport)}
			</span>
		{/if}

		<span class="text-sm tabular-nums">
			{formatWallClockDateTime(timing.leg.departureAt)}
		</span>
		<span class="text-muted-foreground" aria-hidden="true">→</span>
		<span class="text-sm tabular-nums">
			{formatWallClockTime(timing.leg.arrivalAt)}
		</span>
		{#if timing.arrivesNextDay}
			<Badge variant="secondary" title={m.tripDetail_nextDayLabel()}>
				{m.tripDetail_nextDay()}
			</Badge>
		{/if}

		{#if timing.durationMinutes !== null}
			<span class="text-muted-foreground text-xs tabular-nums">
				{formatDurationMinutes(timing.durationMinutes)}
			</span>
		{/if}

		{#if timing.leg.confirmationCode}
			<span class="text-muted-foreground font-mono text-xs">{timing.leg.confirmationCode}</span>
		{/if}

		{#if timing.leg.notes}
			<span class="text-muted-foreground w-full text-xs">{timing.leg.notes}</span>
		{/if}

		{#if canWrite}
			<span class="ms-auto flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon"
					aria-label={m.tripDetail_editSegment()}
					title={m.tripDetail_editSegment()}
					onclick={() => openEdit(timing.leg)}
				>
					<PencilIcon class="size-4" aria-hidden="true" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					aria-label={m.tripDetail_removeSegment()}
					title={m.tripDetail_removeSegment()}
					onclick={() => openRemove(timing.leg)}
				>
					<Trash2Icon class="size-4" aria-hidden="true" />
				</Button>
			</span>
		{/if}
	</li>
{/snippet}

{#snippet itinerary(legs: TripSegmentRow[])}
	<div class="flex flex-col gap-4">
		{#each directionsOf(legs) as entry (entry.direction)}
			<div class="flex flex-col gap-2">
				<div class="flex flex-wrap items-baseline gap-x-3">
					<h4 class="text-sm font-semibold">{tripDirectionLabel(entry.direction)}</h4>
					{#if entry.summary.totalTravelMinutes !== null}
						<span class="text-muted-foreground text-xs tabular-nums">
							{m.tripDetail_totalTravel({
								duration: formatDurationMinutes(entry.summary.totalTravelMinutes)
							})}
						</span>
					{/if}
				</div>

				<ul class="flex flex-col gap-2">
					{#each entry.summary.legs as timing (timing.leg._id)}
						{@render leg(timing)}
					{/each}
				</ul>

				{#if entry.summary.hasMissingZones}
					<p class="text-muted-foreground text-xs">{m.tripDetail_missingZone()}</p>
				{/if}
			</div>
		{/each}
	</div>
{/snippet}

<Card.Root>
	<Card.Header>
		<Card.Title>{m.tripDetail_itinerary()}</Card.Title>
		<Card.Description>{m.tripDetail_itineraryBody()}</Card.Description>
		{#if canWrite}
			<Card.Action>
				<Button variant="outline" size="sm" onclick={() => openAdd(null)}>
					<PlusIcon class="size-4" aria-hidden="true" />
					{m.tripDetail_addSegment()}
				</Button>
			</Card.Action>
		{/if}
	</Card.Header>
	<Card.Content class="flex flex-col gap-6">
		{#if segmentsResponse.isLoading}
			<div class="flex flex-col gap-3">
				<Skeleton class="h-10 w-full" />
				<Skeleton class="h-10 w-full" />
			</div>
		{:else if segments.length === 0}
			<EmptyState
				size="sm"
				variant="plain"
				title={m.tripDetail_noSegments()}
				description={m.tripDetail_noSegmentsBody()}
			>
				{#snippet icon()}
					<PlaneIcon />
				{/snippet}
			</EmptyState>
		{:else}
			{#if groupLegs.length > 0}
				<section class="flex flex-col gap-3">
					<h3 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
						{m.tripDetail_groupFlights()}
					</h3>
					{@render itinerary(groupLegs)}
				</section>
			{/if}

			<!-- Folded under their traveller rather than interleaved: a personal set
			     REPLACES the group's for the direction it covers, and showing both in
			     one list would put somebody on two aircraft at once. -->
			{#each personal as entry (entry.attendee._id)}
				<section class="flex flex-col gap-3">
					<h3 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
						{entry.attendee.contact ? contactDisplayName(entry.attendee.contact) : '—'} ·
						{m.tripDetail_ownFlights()}
					</h3>
					{@render itinerary(entry.legs)}
				</section>
			{/each}
		{/if}
	</Card.Content>
</Card.Root>

<!-- Keyed so switching legs remounts the form: its fields are seeded on open,
     and without the key one leg's half-typed flight number would appear under
     the next one's title. -->
{#key editing?._id ?? `new:${dialogAttendeeId ?? 'group'}`}
	<TripSegmentDialog
		bind:open={dialogOpen}
		tripId={trip._id}
		attendeeId={dialogAttendeeId}
		segment={editing}
	/>
{/key}

<ConfirmDialog
	bind:open={removeOpen}
	title={m.tripDetail_removeSegment()}
	body={m.tripDetail_removeSegmentBody()}
	confirmLabel={m.action_remove()}
	onConfirm={removeSegment}
/>
