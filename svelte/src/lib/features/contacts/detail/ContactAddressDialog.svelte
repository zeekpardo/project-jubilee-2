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
	import type { ContactAddressRow } from './types';

	let {
		open = $bindable(false),
		contactId,
		address = null
	}: {
		open?: boolean;
		contactId: Id<'contacts'>;
		/** Null adds, a row edits. */
		address?: ContactAddressRow | null;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const isEdit = $derived(address !== null);

	const locationCollection = createListCollection({
		items: CONTACT_LOCATIONS.map((value) => ({ value, label: contactLocationLabel(value) }))
	});

	let line1 = $state('');
	let line2 = $state('');
	let city = $state('');
	let stateRegion = $state('');
	let postalCode = $state('');
	let countryCode = $state('');
	let location = $state<string>('home');
	let isPrimary = $state(false);
	let isSaving = $state(false);

	$effect(() => {
		if (!open) return;
		line1 = address?.line1 ?? '';
		line2 = address?.line2 ?? '';
		city = address?.city ?? '';
		stateRegion = address?.state ?? '';
		postalCode = address?.postalCode ?? '';
		countryCode = address?.countryCode ?? '';
		location = address?.location ?? 'home';
		isPrimary = false;
	});

	const canSubmit = $derived(
		[line1, line2, city, stateRegion, postalCode, countryCode].some((part) => part.trim() !== '')
	);

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;

		const shared = {
			line1: line1.trim(),
			line2: line2.trim(),
			city: city.trim(),
			state: stateRegion.trim(),
			postalCode: postalCode.trim(),
			countryCode: countryCode.trim(),
			location: location as 'home' | 'work' | 'other'
		};

		try {
			if (address) {
				await client.mutation(api.contacts.mutations.updateContactAddress, {
					addressId: address._id,
					...shared
				});
			} else {
				await client.mutation(api.contacts.mutations.addContactAddress, {
					contactId,
					...shared,
					isPrimary
				});
			}
			toast.success(m.contactDetail_addressSaved());
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
	<Dialog.Content class="md:max-w-lg">
		<Dialog.Header class="w-full">
			<Dialog.Title>
				{isEdit ? m.contactDetail_editAddress() : m.contactDetail_addAddress()}
			</Dialog.Title>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<Label for="contact-addr-line1">{m.contactDetail_addressLine1()}</Label>
				<Input id="contact-addr-line1" bind:value={line1} />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="contact-addr-line2">{m.contactDetail_addressLine2()}</Label>
				<Input id="contact-addr-line2" bind:value={line2} />
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-addr-city">{m.contactDetail_city()}</Label>
					<Input id="contact-addr-city" bind:value={city} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-addr-state">{m.contactDetail_state()}</Label>
					<Input id="contact-addr-state" bind:value={stateRegion} />
				</div>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-addr-postal">{m.contactDetail_postalCode()}</Label>
					<Input id="contact-addr-postal" bind:value={postalCode} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-addr-country">{m.contactDetail_countryCode()}</Label>
					<Input
						id="contact-addr-country"
						bind:value={countryCode}
						maxlength={2}
						class="uppercase"
					/>
					<p class="text-muted-foreground text-xs">{m.contactDetail_countryCodeHelp()}</p>
				</div>
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
