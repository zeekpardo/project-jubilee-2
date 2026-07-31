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

	import { PHONE_LOCATIONS, contactLocationLabel } from '../contact-info-labels';
	import * as m from '$lib/i18n/messages';
	import type { ContactPhoneRow } from './types';

	let {
		open = $bindable(false),
		contactId,
		phone = null
	}: {
		open?: boolean;
		contactId: Id<'contacts'>;
		/** Null adds, a row edits. */
		phone?: ContactPhoneRow | null;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const isEdit = $derived(phone !== null);

	const locationCollection = createListCollection({
		items: PHONE_LOCATIONS.map((value) => ({ value, label: contactLocationLabel(value) }))
	});

	let number = $state('');
	let location = $state<string>('mobile');
	let carrier = $state('');
	let isPrimary = $state(false);
	let isSaving = $state(false);

	$effect(() => {
		if (!open) return;
		number = phone?.number ?? '';
		location = phone?.location ?? 'mobile';
		carrier = phone?.carrier ?? '';
		isPrimary = false;
	});

	const canSubmit = $derived(number.trim() !== '');

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;

		try {
			if (phone) {
				await client.mutation(api.contacts.mutations.updateContactPhone, {
					phoneId: phone._id,
					number: number.trim(),
					location: location as 'home' | 'work' | 'mobile' | 'other',
					carrier: carrier.trim()
				});
			} else {
				await client.mutation(api.contacts.mutations.addContactPhone, {
					contactId,
					number: number.trim(),
					location: location as 'home' | 'work' | 'mobile' | 'other',
					isPrimary,
					carrier: carrier.trim() || undefined
				});
			}
			toast.success(m.contactDetail_phoneSaved());
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
				>{isEdit ? m.contactDetail_editPhone() : m.contactDetail_addPhone()}</Dialog.Title
			>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<Label for="contact-phone-number">{m.field_phone()}</Label>
				<Input id="contact-phone-number" bind:value={number} required />
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
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
				<div class="flex flex-col gap-1.5">
					<Label for="contact-phone-carrier">{m.contactDetail_carrier()}</Label>
					<Input id="contact-phone-carrier" bind:value={carrier} />
				</div>
			</div>

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
