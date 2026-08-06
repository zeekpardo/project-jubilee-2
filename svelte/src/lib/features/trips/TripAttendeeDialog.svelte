<script lang="ts">
	// Put somebody on the trip: an existing contact, or a person who does not
	// exist yet. Two tabs over one roster row, the same shape
	// `AddCampaignMemberDialog` uses — and `createTripAttendee` goes through the
	// shared contact model, so a person typed in here is the same kind of record
	// as one typed in anywhere else.

	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import * as Tabs from '$lib/primitives/ui/tabs';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Switch } from '$lib/primitives/ui/switch';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import * as m from '$lib/i18n/messages';
	import {
		TRIP_ATTENDEE_STATUSES,
		tripAttendeeStatusLabel,
		type TripAttendeeStatus
	} from './labels';

	let {
		open = $bindable(false),
		tripId,
		rosterContactIds = []
	}: {
		open?: boolean;
		tripId: Id<'trips'>;
		/** Anyone already on this trip is not offered again — unique(tripId, contactId). */
		rosterContactIds?: string[];
	} = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	let search = $state('');
	let contactId = $state('');
	// Free text, same as the stored column: an org spells "Coordinator",
	// "Translator", "Medic" its own way, and this is the parenthetical in the
	// Trip Leaders block — not what puts somebody in it.
	let role = $state('');
	let isLeader = $state(false);
	let status = $state<TripAttendeeStatus>('invited');
	let firstName = $state('');
	let lastName = $state('');
	let email = $state('');
	let phone = $state('');
	let isSaving = $state(false);

	const contactsResponse = useQuery(api.contacts.queries.listContacts, () =>
		auth.isAuthenticated && open ? { search: search.trim() || undefined, limit: 50 } : 'skip'
	);
	const contacts = $derived(contactsResponse.data ?? []);
	const available = $derived(
		contacts.filter((contact) => !rosterContactIds.includes(contact._id as string))
	);

	const contactCollection = $derived(
		createListCollection({
			items: available.map((contact) => ({
				value: contact._id as string,
				label: contactDisplayName(contact)
			}))
		})
	);

	const statusCollection = createListCollection({
		items: TRIP_ATTENDEE_STATUSES.map((value) => ({
			value,
			label: tripAttendeeStatusLabel(value)
		}))
	});

	$effect(() => {
		if (!open) return;
		search = '';
		contactId = '';
		role = '';
		isLeader = false;
		status = 'invited';
		firstName = '';
		lastName = '';
		email = '';
		phone = '';
	});

	function reportError(error: unknown): void {
		toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
	}

	async function addExisting(): Promise<void> {
		if (isSaving || contactId === '') return;
		isSaving = true;
		try {
			await client.mutation(api.tripAttendees.mutations.addTripAttendee, {
				tripId,
				contactId: contactId as Id<'contacts'>,
				role: role.trim() || undefined,
				isLeader,
				status
			});
			toast.success(m.tripDetail_attendeeAdded());
			open = false;
		} catch (error) {
			reportError(error);
		} finally {
			isSaving = false;
		}
	}

	async function createAndAdd(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || firstName.trim() === '') return;
		isSaving = true;
		try {
			await client.mutation(api.tripAttendees.mutations.createTripAttendee, {
				tripId,
				firstName: firstName.trim(),
				lastName: lastName.trim() || undefined,
				email: email.trim() || undefined,
				phone: phone.trim() || undefined,
				role: role.trim() || undefined,
				isLeader,
				status
			});
			toast.success(m.tripDetail_attendeeAdded());
			open = false;
		} catch (error) {
			reportError(error);
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-lg">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.tripDetail_addAttendee()}</Dialog.Title>
		</Dialog.Header>

		<div class="flex w-full flex-col gap-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="attendee-role">{m.field_role()}</Label>
					<Input
						id="attendee-role"
						bind:value={role}
						placeholder={m.tripDetail_rolePlaceholder()}
						autocomplete="off"
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label>{m.field_status()}</Label>
					<Select.Root
						collection={statusCollection}
						value={[status]}
						onValueChange={(details: { value: string[] }): void => {
							const next = details.value[0];
							if (next) status = next as TripAttendeeStatus;
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
			</div>

			<Switch bind:checked={isLeader}>{m.tripDetail_leaderToggle()}</Switch>

			<Tabs.Root value="existing">
				<Tabs.List>
					<Tabs.Trigger value="existing">{m.tripDetail_chooseExisting()}</Tabs.Trigger>
					<Tabs.Trigger value="new">{m.tripDetail_createNew()}</Tabs.Trigger>
				</Tabs.List>

				<Tabs.Content value="existing">
					<div class="flex flex-col gap-4 pt-2">
						<Input
							type="search"
							bind:value={search}
							placeholder={m.list_search()}
							aria-label={m.list_search()}
							autocomplete="off"
						/>
						<Select.Root
							collection={contactCollection}
							value={contactId === '' ? [] : [contactId]}
							onValueChange={(details: { value: string[] }): void => {
								contactId = details.value[0] ?? '';
							}}
						>
							<Select.Trigger class="w-full" placeholder={m.projects_selectContact()} />
							<Select.Content>
								{#each contactCollection.items as option (option.value)}
									<Select.Item item={option}>
										<Select.ItemText>{option.label}</Select.ItemText>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						{#if !contactsResponse.isLoading && available.length === 0}
							<p class="text-muted-foreground text-xs">{m.list_noResults()}</p>
						{/if}
						<div class="flex justify-end">
							<Button onclick={addExisting} loading={isSaving} disabled={contactId === ''}>
								{m.action_add()}
							</Button>
						</div>
					</div>
				</Tabs.Content>

				<Tabs.Content value="new">
					<form class="flex flex-col gap-4 pt-2" onsubmit={createAndAdd}>
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="flex flex-col gap-2">
								<Label for="attendee-first">{m.field_firstName()}</Label>
								<Input id="attendee-first" bind:value={firstName} required autocomplete="off" />
							</div>
							<div class="flex flex-col gap-2">
								<Label for="attendee-last">{m.field_lastName()}</Label>
								<Input id="attendee-last" bind:value={lastName} autocomplete="off" />
							</div>
						</div>
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="flex flex-col gap-2">
								<Label for="attendee-email">{m.field_email()}</Label>
								<Input id="attendee-email" type="email" bind:value={email} autocomplete="off" />
							</div>
							<div class="flex flex-col gap-2">
								<Label for="attendee-phone">{m.field_phone()}</Label>
								<Input id="attendee-phone" bind:value={phone} autocomplete="off" />
							</div>
						</div>
						<div class="flex justify-end">
							<Button type="submit" loading={isSaving} disabled={firstName.trim() === ''}>
								{m.action_create()}
							</Button>
						</div>
					</form>
				</Tabs.Content>
			</Tabs.Root>
		</div>

		<Dialog.Footer class="w-full">
			<Button variant="outline" onclick={() => (open = false)} disabled={isSaving}>
				{m.action_cancel()}
			</Button>
		</Dialog.Footer>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
