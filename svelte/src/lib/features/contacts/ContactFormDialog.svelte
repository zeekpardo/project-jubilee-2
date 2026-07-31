<script lang="ts">
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';
	import { createListCollection } from '@ark-ui/svelte/select';

	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import * as m from '$lib/i18n/messages';

	import type { ContactRow } from './types';

	let {
		open = $bindable(false),
		contact = null
	}: {
		open?: boolean;
		contact?: ContactRow | null;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const isEdit = $derived(contact !== null);

	type PreferredContact = NonNullable<ContactRow['preferredContact']>;
	type Transparency = NonNullable<ContactRow['transparency']>;

	// The schema types these as closed unions with no "cleared" member, so an
	// unset choice is sent as undefined rather than an empty string.
	const UNSET = '__none__';

	const preferredCollection = createListCollection({
		items: [
			{ value: UNSET, label: m.settings_impactTag_none() },
			{ value: 'email', label: m.contactDetail_preferred_email() },
			{ value: 'mail', label: m.contactDetail_preferred_mail() },
			{ value: 'phone', label: m.contactDetail_preferred_phone() }
		]
	});

	const transparencyCollection = createListCollection({
		items: [
			{ value: UNSET, label: m.settings_impactTag_none() },
			{ value: 'summary', label: m.contactDetail_transparency_summary() },
			{ value: 'full', label: m.contactDetail_transparency_full() }
		]
	});

	let firstName = $state('');
	let lastName = $state('');
	let email = $state('');
	let phone = $state('');
	let organization = $state('');
	let addressLine1 = $state('');
	let addressLine2 = $state('');
	let city = $state('');
	let stateRegion = $state('');
	let postalCode = $state('');
	let country = $state('');
	let preferredContact = $state<string>(UNSET);
	let transparency = $state<string>(UNSET);
	let notes = $state('');
	let saving = $state(false);
	let errorMessage = $state('');

	$effect(() => {
		if (!open) return;
		firstName = contact?.firstName ?? '';
		lastName = contact?.lastName ?? '';
		email = contact?.email ?? '';
		phone = contact?.phone ?? '';
		organization = contact?.organization ?? '';
		addressLine1 = contact?.addressLine1 ?? '';
		addressLine2 = contact?.addressLine2 ?? '';
		city = contact?.city ?? '';
		stateRegion = contact?.state ?? '';
		postalCode = contact?.postalCode ?? '';
		country = contact?.country ?? '';
		preferredContact = contact?.preferredContact ?? UNSET;
		transparency = contact?.transparency ?? UNSET;
		notes = contact?.notes ?? '';
		errorMessage = '';
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!firstName.trim()) return;
		saving = true;
		errorMessage = '';
		try {
			// An empty string clears the stored value; undefined would leave it be.
			const fields = {
				firstName: firstName.trim(),
				lastName: lastName.trim(),
				email: email.trim(),
				phone: phone.trim(),
				organization: organization.trim(),
				addressLine1: addressLine1.trim(),
				addressLine2: addressLine2.trim(),
				city: city.trim(),
				state: stateRegion.trim(),
				postalCode: postalCode.trim(),
				country: country.trim(),
				notes: notes.trim()
			};
			const chosenPreferred =
				preferredContact === UNSET ? null : (preferredContact as PreferredContact);
			const chosenTransparency = transparency === UNSET ? null : (transparency as Transparency);

			if (isEdit && contact) {
				await client.mutation(api.contacts.mutations.updateContact, {
					contactId: contact._id,
					...fields,
					// null clears; undefined would leave a previously-set value alone.
					preferredContact: chosenPreferred,
					transparency: chosenTransparency
				});
			} else {
				await client.mutation(api.contacts.mutations.createContact, fields);
			}
			toast.success(m.contacts_saved());
			open = false;
		} catch (error) {
			errorMessage = error instanceof ConvexError ? String(error.data) : m.state_saveFailed();
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{isEdit ? m.contacts_edit() : m.contacts_new()}</Dialog.Title>
		</Dialog.Header>
		<form class="flex flex-col gap-4" onsubmit={submit}>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-first">{m.field_firstName()}</Label>
					<Input id="contact-first" bind:value={firstName} required />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-last">{m.field_lastName()}</Label>
					<Input id="contact-last" bind:value={lastName} />
				</div>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-email">{m.field_email()}</Label>
					<Input id="contact-email" type="email" bind:value={email} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-phone">{m.field_phone()}</Label>
					<Input id="contact-phone" bind:value={phone} />
				</div>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="contact-org">{m.field_organization()}</Label>
				<Input id="contact-org" bind:value={organization} />
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="contact-address1">{m.contactDetail_addressLine1()}</Label>
				<Input id="contact-address1" bind:value={addressLine1} />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="contact-address2">{m.contactDetail_addressLine2()}</Label>
				<Input id="contact-address2" bind:value={addressLine2} />
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-city">{m.contactDetail_city()}</Label>
					<Input id="contact-city" bind:value={city} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-state">{m.contactDetail_state()}</Label>
					<Input id="contact-state" bind:value={stateRegion} />
				</div>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-postal">{m.contactDetail_postalCode()}</Label>
					<Input id="contact-postal" bind:value={postalCode} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-country">{m.contactDetail_country()}</Label>
					<Input id="contact-country" bind:value={country} />
				</div>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label>{m.contactDetail_preferredContact()}</Label>
					<Select.Root
						collection={preferredCollection}
						value={[preferredContact]}
						onValueChange={(details: { value: string[] }): void => {
							preferredContact = details.value[0] ?? UNSET;
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.settings_impactTag_none()} />
						<Select.Content>
							{#each preferredCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label>{m.contactDetail_transparency()}</Label>
					<Select.Root
						collection={transparencyCollection}
						value={[transparency]}
						onValueChange={(details: { value: string[] }): void => {
							transparency = details.value[0] ?? UNSET;
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.settings_impactTag_none()} />
						<Select.Content>
							{#each transparencyCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="contact-notes">{m.field_notes()}</Label>
				<Textarea id="contact-notes" bind:value={notes} rows={3} />
			</div>

			{#if errorMessage}
				<p class="text-destructive text-sm">{errorMessage}</p>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={saving}>
					{isEdit ? m.action_saveChanges() : m.action_create()}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
