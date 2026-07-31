<script lang="ts">
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import * as Dialog from '$lib/primitives/ui/dialog';
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

	let firstName = $state('');
	let lastName = $state('');
	let email = $state('');
	let phone = $state('');
	let organization = $state('');
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
				notes: notes.trim()
			};
			if (isEdit && contact) {
				await client.mutation(api.contacts.mutations.updateContact, {
					contactId: contact._id,
					...fields
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
