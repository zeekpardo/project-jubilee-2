<script lang="ts">
	// One leg of a flight, added or edited.
	//
	// ONE dialog, reused for the group itinerary and for a traveller's own legs —
	// §5's "different flights" copies the group's legs onto an attendee and then
	// opens this same form, which is why there is no second itinerary builder.
	//
	// THE TIMES are `datetime-local` inputs on purpose: the control's value is
	// exactly 'YYYY-MM-DDTHH:mm' with no zone, which is the stored shape and what
	// the boarding pass says. Nothing here parses it — the string travels to the
	// mutation untouched, and the zone goes in its own field beside it.

	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';
	import { TRIP_DIRECTIONS, tripDirectionLabel, type TripDirection } from './labels';
	import type { TripSegmentRow } from './types';

	let {
		open = $bindable(false),
		tripId,
		attendeeId = null,
		segment = null
	}: {
		open?: boolean;
		tripId: Id<'trips'>;
		/** Null adds to the GROUP itinerary; an id adds one traveller's own leg. */
		attendeeId?: Id<'tripAttendees'> | null;
		/** Null adds a leg, a row edits it. */
		segment?: TripSegmentRow | null;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const isEdit = $derived(segment !== null);

	let direction = $state<TripDirection>('outbound');
	let airline = $state('');
	let flightNumber = $state('');
	let departureAirport = $state('');
	let arrivalAirport = $state('');
	let departureAt = $state('');
	let arrivalAt = $state('');
	let departureTimeZone = $state('');
	let arrivalTimeZone = $state('');
	let confirmationCode = $state('');
	let notes = $state('');
	let isSaving = $state(false);

	const directionCollection = createListCollection({
		items: TRIP_DIRECTIONS.map((value) => ({ value, label: tripDirectionLabel(value) }))
	});

	$effect(() => {
		if (!open) return;
		const source = segment;
		direction = source?.direction ?? 'outbound';
		airline = source?.airline ?? '';
		flightNumber = source?.flightNumber ?? '';
		departureAirport = source?.departureAirport ?? '';
		arrivalAirport = source?.arrivalAirport ?? '';
		departureAt = source?.departureAt ?? '';
		arrivalAt = source?.arrivalAt ?? '';
		departureTimeZone = source?.departureTimeZone ?? '';
		arrivalTimeZone = source?.arrivalTimeZone ?? '';
		confirmationCode = source?.confirmationCode ?? '';
		notes = source?.notes ?? '';
	});

	const canSubmit = $derived(
		airline.trim() !== '' && flightNumber.trim() !== '' && departureAt !== '' && arrivalAt !== ''
	);

	/** `null` clears the column on an edit; `undefined` leaves it unset on a create. */
	function cleared(value: string): string | null {
		return value.trim() || null;
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;

		try {
			if (segment) {
				await client.mutation(api.tripSegments.mutations.updateTripSegment, {
					segmentId: segment._id,
					direction,
					airline: airline.trim(),
					flightNumber: flightNumber.trim(),
					departureAirport: cleared(departureAirport),
					arrivalAirport: cleared(arrivalAirport),
					departureAt,
					arrivalAt,
					departureTimeZone: cleared(departureTimeZone),
					arrivalTimeZone: cleared(arrivalTimeZone),
					confirmationCode: cleared(confirmationCode),
					notes: cleared(notes)
				});
			} else {
				await client.mutation(api.tripSegments.mutations.addTripSegment, {
					tripId,
					attendeeId: attendeeId ?? undefined,
					direction,
					airline: airline.trim(),
					flightNumber: flightNumber.trim(),
					departureAirport: departureAirport.trim() || undefined,
					arrivalAirport: arrivalAirport.trim() || undefined,
					departureAt,
					arrivalAt,
					departureTimeZone: departureTimeZone.trim() || undefined,
					arrivalTimeZone: arrivalTimeZone.trim() || undefined,
					confirmationCode: confirmationCode.trim() || undefined,
					notes: notes.trim() || undefined
				});
			}
			open = false;
		} catch (error: unknown) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-xl">
		<Dialog.Header class="w-full">
			<Dialog.Title>
				{isEdit ? m.tripDetail_editSegment() : m.tripDetail_addSegment()}
			</Dialog.Title>
		</Dialog.Header>

		<form class="flex w-full flex-col gap-4" onsubmit={handleSubmit}>
			<div class="grid gap-4 sm:grid-cols-3">
				<div class="flex flex-col gap-2">
					<Label>{m.tripDetail_direction()}</Label>
					<Select.Root
						collection={directionCollection}
						value={[direction]}
						onValueChange={(details: { value: string[] }): void => {
							const next = details.value[0];
							if (next) direction = next as TripDirection;
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.tripDetail_direction()} />
						<Select.Content>
							{#each directionCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="segment-airline">{m.tripDetail_airline()}</Label>
					<Input id="segment-airline" bind:value={airline} required autocomplete="off" />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="segment-flight">{m.tripDetail_flightNumber()}</Label>
					<Input id="segment-flight" bind:value={flightNumber} required autocomplete="off" />
				</div>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="segment-from">{m.tripDetail_departureAirport()}</Label>
					<Input
						id="segment-from"
						bind:value={departureAirport}
						maxlength={3}
						placeholder="DFW"
						autocomplete="off"
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="segment-to">{m.tripDetail_arrivalAirport()}</Label>
					<Input
						id="segment-to"
						bind:value={arrivalAirport}
						maxlength={3}
						placeholder="DOH"
						autocomplete="off"
					/>
				</div>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="segment-departs">{m.tripDetail_departureAt()}</Label>
					<Input id="segment-departs" type="datetime-local" bind:value={departureAt} required />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="segment-arrives">{m.tripDetail_arrivalAt()}</Label>
					<Input id="segment-arrives" type="datetime-local" bind:value={arrivalAt} required />
				</div>
			</div>
			<p class="text-muted-foreground -mt-2 text-xs">{m.tripDetail_timeHelp()}</p>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="segment-from-zone">{m.tripDetail_departureTimeZone()}</Label>
					<Input
						id="segment-from-zone"
						bind:value={departureTimeZone}
						placeholder="America/Chicago"
						autocomplete="off"
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="segment-to-zone">{m.tripDetail_arrivalTimeZone()}</Label>
					<Input
						id="segment-to-zone"
						bind:value={arrivalTimeZone}
						placeholder="Asia/Qatar"
						autocomplete="off"
					/>
				</div>
			</div>
			<p class="text-muted-foreground -mt-2 text-xs">{m.tripDetail_zoneHelp()}</p>

			<div class="flex flex-col gap-2">
				<Label for="segment-confirmation">{m.tripDetail_confirmationCode()}</Label>
				<Input id="segment-confirmation" bind:value={confirmationCode} autocomplete="off" />
			</div>

			<div class="flex flex-col gap-2">
				<Label for="segment-notes">{m.field_notes()}</Label>
				<Textarea id="segment-notes" bind:value={notes} rows={2} />
			</div>

			<Dialog.Footer class="w-full">
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || !canSubmit}>
					{isEdit ? m.action_save() : m.action_add()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
