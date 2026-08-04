<script lang="ts">
	// The roster. These rows are the `team` side of the work — the organization's
	// own people — and linking a record to the trip never turns them into
	// projectMembers, which is the whole served-versus-team distinction of §1.
	//
	// "Different flights" copies the GROUP legs onto one traveller, prefilled, so
	// the coordinator edits the two fields that differ instead of retyping a
	// four-leg itinerary. The mutation refuses rather than merges when they
	// already have their own — an itinerary that quietly doubles is worse than an
	// error message — and that refusal is surfaced here as it is written.

	// Primitives
	import { resolve } from '$app/paths';
	import * as Card from '$lib/primitives/ui/card';
	import * as Select from '$lib/primitives/ui/select';
	import * as Table from '$lib/primitives/ui/table';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { InlineEdit } from '$lib/primitives/ui/inline-edit';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { Switch } from '$lib/primitives/ui/switch';
	import type { SwitchCheckedChangeDetails } from '$lib/primitives/ui/switch';
	import { Badge } from '$lib/primitives/ui/badge';
	import { createListCollection } from '@ark-ui/svelte/select';
	import PlaneIcon from '@lucide/svelte/icons/plane';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc } from '$convex/_generated/dataModel';

	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import * as m from '$lib/i18n/messages';
	import {
		TRIP_ATTENDEE_STATUSES,
		tripAttendeeStatusLabel,
		tripAttendeeStatusVariant,
		type TripAttendeeStatus
	} from './labels';
	import TripAttendeeDialog from './TripAttendeeDialog.svelte';
	import type { TripAttendeeRow } from './types';

	let { trip, canWrite }: { trip: Doc<'trips'>; canWrite: boolean } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const attendeesResponse = useQuery(api.tripAttendees.queries.listTripAttendees, () => ({
		tripId: trip._id
	}));
	const attendees = $derived(attendeesResponse.data ?? []);
	const rosterContactIds = $derived(attendees.map((attendee) => attendee.contactId as string));

	const statusCollection = createListCollection({
		items: TRIP_ATTENDEE_STATUSES.map((value) => ({
			value,
			label: tripAttendeeStatusLabel(value)
		}))
	});

	let addOpen = $state(false);
	let removeOpen = $state(false);
	let removing = $state<TripAttendeeRow | null>(null);

	function reportError(error: unknown): void {
		toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
	}

	async function saveRole(attendee: TripAttendeeRow, next: string): Promise<void> {
		// The mutation takes `null` to CLEAR — an absent argument would leave the
		// old role in place, so an emptied field has to say so explicitly.
		await client.mutation(api.tripAttendees.mutations.setTripAttendeeRole, {
			attendeeId: attendee._id,
			role: next.trim() || null
		});
	}

	async function toggleLeader(attendee: TripAttendeeRow, isLeader: boolean): Promise<void> {
		try {
			await client.mutation(api.tripAttendees.mutations.setTripAttendeeLeader, {
				attendeeId: attendee._id,
				isLeader
			});
		} catch (error) {
			reportError(error);
		}
	}

	async function setStatus(attendee: TripAttendeeRow, status: TripAttendeeStatus): Promise<void> {
		try {
			await client.mutation(api.tripAttendees.mutations.setTripAttendeeStatus, {
				attendeeId: attendee._id,
				status
			});
		} catch (error) {
			reportError(error);
		}
	}

	async function copyFlights(attendee: TripAttendeeRow): Promise<void> {
		try {
			const created = await client.mutation(
				api.tripSegments.mutations.copyGroupSegmentsToAttendee,
				{ attendeeId: attendee._id }
			);
			toast.success(m.tripDetail_flightsCopied({ count: created.length }));
		} catch (error) {
			reportError(error);
		}
	}

	function openRemove(attendee: TripAttendeeRow): void {
		removing = attendee;
		removeOpen = true;
	}

	async function removeAttendee(): Promise<void> {
		const target = removing;
		if (!target) return;
		await client.mutation(api.tripAttendees.mutations.removeTripAttendee, {
			attendeeId: target._id
		});
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.tripDetail_attending()}</Card.Title>
		<Card.Description>{m.tripDetail_attendingBody()}</Card.Description>
		{#if canWrite}
			<Card.Action>
				<Button variant="outline" size="sm" onclick={() => (addOpen = true)}>
					<PlusIcon class="size-4" aria-hidden="true" />
					{m.tripDetail_addAttendee()}
				</Button>
			</Card.Action>
		{/if}
	</Card.Header>
	<Card.Content>
		{#if attendeesResponse.isLoading}
			<div class="flex flex-col gap-3">
				<Skeleton class="h-8 w-full" />
				<Skeleton class="h-8 w-full" />
				<Skeleton class="h-8 w-full" />
			</div>
		{:else if attendees.length === 0}
			<EmptyState
				size="sm"
				variant="plain"
				title={m.tripDetail_noAttendees()}
				description={m.tripDetail_noAttendeesBody()}
			>
				{#snippet icon()}
					<UsersIcon />
				{/snippet}
			</EmptyState>
		{:else}
			<Table.Root>
				<Table.Header class="bg-muted">
					<Table.Row>
						<Table.Head>{m.field_name()}</Table.Head>
						<Table.Head>{m.field_role()}</Table.Head>
						<Table.Head>{m.tripDetail_leaderToggle()}</Table.Head>
						<Table.Head>{m.field_status()}</Table.Head>
						<Table.Head class="w-40 text-right">{m.field_actions()}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each attendees as attendee (attendee._id)}
						<Table.Row>
							<Table.Cell class="font-medium">
								{#if attendee.contact}
									<a
										class="hover:underline"
										href={resolve('/app/admin/contacts/[id]', { id: attendee.contact._id })}
									>
										{contactDisplayName(attendee.contact)}
									</a>
								{:else}
									—
								{/if}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">
								{#if canWrite}
									<InlineEdit
										value={attendee.role ?? ''}
										placeholder={m.tripDetail_rolePlaceholder()}
										ariaLabel={m.tripDetail_editRole()}
										onSave={(next) => saveRole(attendee, next)}
									/>
								{:else}
									{attendee.role ?? '—'}
								{/if}
							</Table.Cell>
							<Table.Cell>
								{#if canWrite}
									<Switch
										checked={attendee.isLeader}
										aria-label={m.tripDetail_leaderToggle()}
										onCheckedChange={(details: SwitchCheckedChangeDetails) =>
											toggleLeader(attendee, details.checked)}
									/>
								{:else if attendee.isLeader}
									<Badge variant="secondary">{m.tripDetail_leaderToggle()}</Badge>
								{:else}
									<span class="text-muted-foreground" aria-hidden="true">—</span>
								{/if}
							</Table.Cell>
							<Table.Cell>
								{#if canWrite}
									<Select.Root
										collection={statusCollection}
										value={[attendee.status]}
										onValueChange={(details: { value: string[] }): void => {
											const next = details.value[0];
											if (next) void setStatus(attendee, next as TripAttendeeStatus);
										}}
									>
										<Select.Label class="sr-only">{m.field_status()}</Select.Label>
										<Select.Trigger size="sm" class="w-32" placeholder={m.field_status()} />
										<Select.Content>
											{#each statusCollection.items as option (option.value)}
												<Select.Item item={option}>
													<Select.ItemText>{option.label}</Select.ItemText>
												</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								{:else}
									<Badge variant={tripAttendeeStatusVariant(attendee.status)}>
										{tripAttendeeStatusLabel(attendee.status)}
									</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								{#if canWrite}
									<div class="flex justify-end gap-1">
										<Button
											variant="ghost"
											size="icon"
											aria-label={m.tripDetail_differentFlights()}
											title={m.tripDetail_differentFlights()}
											onclick={() => copyFlights(attendee)}
										>
											<PlaneIcon class="size-4" aria-hidden="true" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											aria-label={m.tripDetail_removeAttendee()}
											title={m.tripDetail_removeAttendee()}
											onclick={() => openRemove(attendee)}
										>
											<Trash2Icon class="size-4" aria-hidden="true" />
										</Button>
									</div>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</Card.Content>
</Card.Root>

<TripAttendeeDialog bind:open={addOpen} tripId={trip._id} {rosterContactIds} />

<ConfirmDialog
	bind:open={removeOpen}
	title={m.tripDetail_removeAttendee()}
	body={m.tripDetail_removeAttendeeBody()}
	confirmLabel={m.action_remove()}
	onConfirm={removeAttendee}
/>
