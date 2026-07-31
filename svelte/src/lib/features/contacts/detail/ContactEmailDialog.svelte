<script lang="ts">
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Checkbox } from '$lib/primitives/ui/checkbox';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import { CONTACT_LOCATIONS, contactLocationLabel } from '../contact-info-labels';
	import * as m from '$lib/i18n/messages';
	import type { ContactEmailRow } from './types';

	let {
		open = $bindable(false),
		contactId,
		email = null
	}: {
		open?: boolean;
		contactId: Id<'contacts'>;
		/** Null adds, a row edits. */
		email?: ContactEmailRow | null;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const isEdit = $derived(email !== null);

	const locationCollection = createListCollection({
		items: CONTACT_LOCATIONS.map((value) => ({ value, label: contactLocationLabel(value) }))
	});

	let address = $state('');
	let location = $state<string>('home');
	let blocked = $state(false);
	let isPrimary = $state(false);
	let isSaving = $state(false);

	$effect(() => {
		if (!open) return;
		address = email?.address ?? '';
		location = email?.location ?? 'home';
		blocked = email?.blocked ?? false;
		isPrimary = false;
	});

	const canSubmit = $derived(address.trim() !== '');

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;

		try {
			if (email) {
				await client.mutation(api.contacts.mutations.updateContactEmail, {
					emailId: email._id,
					address: address.trim(),
					location: location as 'home' | 'work' | 'other',
					blocked
				});
			} else {
				await client.mutation(api.contacts.mutations.addContactEmail, {
					contactId,
					address: address.trim(),
					location: location as 'home' | 'work' | 'other',
					isPrimary,
					blocked
				});
			}
			toast.success(m.contactDetail_emailSaved());
			open = false;
		} catch (error: unknown) {
			toast.error(
				error instanceof ConvexError
					? String(error.data)
					: error instanceof Error
						? error.message
						: m.state_saveFailed()
			);
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header class="w-full">
			<Dialog.Title
				>{isEdit ? m.contactDetail_editEmail() : m.contactDetail_addEmail()}</Dialog.Title
			>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<Label for="contact-email-address">{m.field_email()}</Label>
				<Input id="contact-email-address" type="email" bind:value={address} required />
			</div>

			<div class="flex flex-col gap-1.5">
				<Label>{m.contactDetail_location()}</Label>
				<Select.Root
					collection={locationCollection}
					value={[location]}
					onValueChange={(details: { value: string[] }): void => {
						const next = details.value[0];
						if (next) location = next;
					}}
				>
					<Select.Trigger class="w-full" placeholder={m.contactDetail_location()} />
					<Select.Content>
						{#each locationCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<Checkbox checked={blocked} onCheckedChange={(d) => (blocked = d.checked === true)}>
				{m.contactDetail_blocked()}
			</Checkbox>
			<p class="text-muted-foreground -mt-2 text-xs">{m.contactDetail_blockedHelp()}</p>

			{#if !isEdit}
				<Checkbox checked={isPrimary} onCheckedChange={(d) => (isPrimary = d.checked === true)}>
					{m.contactDetail_setAsPrimary()}
				</Checkbox>
			{/if}

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
