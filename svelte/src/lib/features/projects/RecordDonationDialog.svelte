<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import * as Alert from '$lib/primitives/ui/alert';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { createListCollection } from '@ark-ui/svelte/select';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import AmountField from '$lib/features/money/AmountField.svelte';
	import { MAX_UPLOAD_BYTES, discardReceipt, uploadReceipt } from '$lib/features/money/receipt';
	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import { positiveDollarsToCents } from '$lib/features/settings/amount';
	import * as m from '$lib/i18n/messages';

	let {
		open = $bindable(false),
		projectId,
		campaignId
	}: {
		open?: boolean;
		projectId: Id<'projects'>;
		campaignId: Id<'campaigns'>;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	// Same sentinel the ledger's transaction dialog uses: an anonymous gift is a
	// deliberate choice in the list, not an empty selection.
	const NO_DONOR = '__none__';

	let amount = $state('');
	let occurredOn = $state('');
	let method = $state('');
	let reference = $state('');
	let donorSearch = $state('');
	let donorId = $state<string>(NO_DONOR);
	// Captured when the donor is picked so the chosen name survives a later
	// search that no longer returns them.
	let donorLabel = $state('');
	let receipt = $state<File | null>(null);
	let receiptInput = $state<HTMLInputElement | null>(null);
	let isSaving = $state(false);
	let failure = $state<string | null>(null);

	$effect(() => {
		if (!open) return;
		amount = '';
		occurredOn = '';
		method = '';
		reference = '';
		donorSearch = '';
		donorId = NO_DONOR;
		donorLabel = '';
		receipt = null;
		// The element keeps its own selection, so clearing the state is not
		// enough — a re-opened dialog would still show the last file's name.
		if (receiptInput) receiptInput.value = '';
		failure = null;
	});

	const contactsResponse = useQuery(api.contacts.queries.listContacts, () =>
		open ? { search: donorSearch.trim() || undefined, limit: 50 } : 'skip'
	);
	const contacts = $derived(contactsResponse.data ?? []);

	const donorCollection = $derived(
		createListCollection({
			items: [
				{ value: NO_DONOR, label: m.money_noDonor() },
				// A donor filtered out by the current search is kept in the list, so
				// the trigger never falls back to reading "no donor" for a gift that
				// has one.
				...(donorId !== NO_DONOR && !contacts.some((contact) => contact._id === donorId)
					? [{ value: donorId, label: donorLabel }]
					: []),
				...contacts.map((contact) => ({
					value: contact._id as string,
					label: contactDisplayName(contact)
				}))
			]
		})
	);

	// Dollars become cents once, here at the boundary; the mutation re-checks
	// the result is a positive integer before it reaches the ledger.
	const amountCents = $derived(amount.trim() === '' ? null : positiveDollarsToCents(amount));
	const amountError = $derived(
		amount.trim() !== '' && amountCents === null ? m.projects_donationAmountInvalid() : null
	);

	// The donor is not part of this: an anonymous gift is still a gift.
	const canSubmit = $derived(amountCents !== null);

	function handleReceiptChange(event: Event): void {
		const target = event.currentTarget as HTMLInputElement;
		receipt = target.files?.item(0) ?? null;
		if (receipt && receipt.size > MAX_UPLOAD_BYTES) {
			failure = m.projects_donationReceiptTooLarge();
		} else if (failure === m.projects_donationReceiptTooLarge()) {
			failure = null;
		}
	}

	function describe(error: unknown): string {
		return error instanceof ConvexError
			? String(error.data)
			: error instanceof Error
				? error.message
				: m.state_saveFailed();
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit || amountCents === null) return;

		// Checked before the upload, not after, so an oversized pick never costs
		// a round trip or leaves an orphaned blob behind.
		if (receipt && receipt.size > MAX_UPLOAD_BYTES) {
			failure = m.projects_donationReceiptTooLarge();
			return;
		}

		isSaving = true;
		failure = null;
		try {
			const receiptStorageId = receipt
				? await uploadReceipt(client, api, campaignId, receipt)
				: undefined;

			try {
				// One mutation writes the donation and its allocation together — a
				// gift in the ledger is never left attributed to no project.
				await client.mutation(api.transactions.donation.recordProjectDonation, {
					projectId,
					campaignId,
					amountCents,
					contactId: donorId === NO_DONOR ? undefined : (donorId as Id<'contacts'>),
					occurredOn: occurredOn.trim() || undefined,
					method: method.trim() || undefined,
					reference: reference.trim() || undefined,
					receiptStorageId
				});
			} catch (error: unknown) {
				// The bytes landed but nothing points at them. Clean up, then let the
				// original failure through untouched — it is what the user must read.
				if (receiptStorageId) await discardReceipt(client, api, campaignId, receiptStorageId);
				throw error;
			}
			toast.success(m.projects_donationSaved());
			open = false;
		} catch (error: unknown) {
			// The dialog stays open so the reason is read rather than flashing past.
			failure = describe(error);
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-lg">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.money_newDonation()}</Dialog.Title>
			<Dialog.Description>{m.projects_donationIntro()}</Dialog.Description>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<AmountField id="donation-amount" bind:value={amount} error={amountError} />

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="donation-date">{m.money_occurredOn()}</Label>
					<Input id="donation-date" type="date" bind:value={occurredOn} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="donation-method">{m.money_method()}</Label>
					<Input id="donation-method" bind:value={method} autocomplete="off" />
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="donation-reference">{m.money_reference()}</Label>
				<Input id="donation-reference" bind:value={reference} autocomplete="off" />
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="donation-donor-search">{m.money_donor()}</Label>
				<Input
					id="donation-donor-search"
					type="search"
					bind:value={donorSearch}
					placeholder={m.list_search()}
					autocomplete="off"
				/>
				<Select.Root
					collection={donorCollection}
					value={[donorId]}
					onValueChange={(details: { value: string[] }): void => {
						const next = details.value[0];
						if (!next) return;
						donorId = next;
						donorLabel =
							donorCollection.items.find((item) => item.value === next)?.label ?? donorLabel;
					}}
				>
					<Select.Trigger class="w-full" placeholder={m.money_noDonor()} />
					<Select.Content>
						{#each donorCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<p class="text-muted-foreground text-xs">{m.projects_donationDonorHelp()}</p>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="donation-receipt">{m.projects_donationReceipt()}</Label>
				<Input
					id="donation-receipt"
					type="file"
					accept="image/*,application/pdf"
					bind:ref={receiptInput}
					onchange={handleReceiptChange}
					class="h-auto py-1.5"
				/>
				<p class="text-muted-foreground text-xs">{m.projects_donationReceiptHelp()}</p>
			</div>

			{#if failure}
				<Alert.Root variant="warning" class="w-full">
					<TriangleAlertIcon class="size-4" />
					<Alert.Title>{m.state_error()}</Alert.Title>
					<Alert.Description>{failure}</Alert.Description>
				</Alert.Root>
			{/if}

			<Dialog.Footer class="w-full">
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || !canSubmit}>
					{m.money_newDonation()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
