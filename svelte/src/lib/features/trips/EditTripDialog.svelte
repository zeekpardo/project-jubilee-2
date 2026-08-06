<script lang="ts">
	// Editing a trip. The campaign is deliberately absent: a trip belongs to the
	// campaign whose work it goes to do, and moving it would strand its attendees,
	// whose rows carry campaignId directly. The mutation does not accept one
	// either.
	//
	// The name is a plain field here with no prefill anywhere near it — the
	// `{Campaign} — {Project} — {startOn}` composition happens once, in the create
	// dialog, and the name is the user's from then on.

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
	import type { Doc } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';
	import { TRIP_STATUSES, tripStatusLabel, type TripStatus } from './labels';

	let { open = $bindable(false), trip }: { open?: boolean; trip: Doc<'trips'> } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let name = $state('');
	let startOn = $state('');
	let endOn = $state('');
	let destination = $state('');
	let countryCode = $state('');
	let status = $state<TripStatus>('planning');
	let summary = $state('');
	let notes = $state('');
	let isSaving = $state(false);

	const statusCollection = createListCollection({
		items: TRIP_STATUSES.map((value) => ({ value, label: tripStatusLabel(value) }))
	});

	$effect(() => {
		if (!open) return;
		name = trip.name;
		startOn = trip.startOn;
		endOn = trip.endOn;
		destination = trip.destination;
		countryCode = trip.countryCode ?? '';
		status = trip.status;
		summary = trip.summary ?? '';
		notes = trip.notes ?? '';
	});

	const canSubmit = $derived(
		name.trim() !== '' && startOn !== '' && endOn !== '' && destination.trim() !== ''
	);

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;

		try {
			await client.mutation(api.trips.mutations.updateTrip, {
				tripId: trip._id,
				name: name.trim(),
				startOn,
				endOn,
				destination: destination.trim(),
				// `null` clears these three; an absent argument would leave them.
				countryCode: countryCode.trim() || null,
				status,
				summary: summary.trim() || null,
				notes: notes.trim() || null
			});
			open = false;
		} catch (error: unknown) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-lg">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.trips_edit()}</Dialog.Title>
		</Dialog.Header>

		<form class="flex w-full flex-col gap-4" onsubmit={handleSubmit}>
			<div class="flex flex-col gap-2">
				<Label for="edit-trip-name">{m.field_name()}</Label>
				<Input id="edit-trip-name" bind:value={name} required autocomplete="off" />
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="edit-trip-start">{m.trips_startOn()}</Label>
					<Input id="edit-trip-start" type="date" bind:value={startOn} required />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="edit-trip-end">{m.trips_endOn()}</Label>
					<Input id="edit-trip-end" type="date" bind:value={endOn} required />
				</div>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="edit-trip-destination">{m.trips_destination()}</Label>
					<Input id="edit-trip-destination" bind:value={destination} required autocomplete="off" />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="edit-trip-country">{m.trips_countryCode()}</Label>
					<Input id="edit-trip-country" bind:value={countryCode} maxlength={2} autocomplete="off" />
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<Label>{m.field_status()}</Label>
				<Select.Root
					collection={statusCollection}
					value={[status]}
					onValueChange={(details: { value: string[] }): void => {
						const next = details.value[0];
						if (next) status = next as TripStatus;
					}}
				>
					<Select.Trigger class="w-full" placeholder={m.field_status()} />
					<Select.Content>
						{#each statusCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="flex flex-col gap-2">
				<Label for="edit-trip-summary">{m.trips_summary()}</Label>
				<Textarea id="edit-trip-summary" bind:value={summary} rows={2} />
			</div>

			<div class="flex flex-col gap-2">
				<Label for="edit-trip-notes">{m.field_notes()}</Label>
				<Textarea id="edit-trip-notes" bind:value={notes} rows={3} />
			</div>

			<Dialog.Footer class="w-full">
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || !canSubmit}>
					{m.action_save()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
