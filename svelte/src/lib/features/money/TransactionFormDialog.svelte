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
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import { dollarsToCents, centsToDollarInput } from '$lib/features/settings/amount';
	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import { newTransactionTitle } from './labels';
	import AmountField from './AmountField.svelte';
	import type { DonorOption, Transaction, TransactionType } from './types';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const client = useConvexClient();

	const NO_DONOR = '__none__';

	let {
		open = $bindable(false),
		defaultType,
		transaction = null,
		donors = []
	}: {
		open?: boolean;
		/** The tab the ledger is showing; the type a new transaction gets. */
		defaultType: TransactionType;
		/** Null records a new transaction, a row edits it. */
		transaction?: Transaction | null;
		donors?: DonorOption[];
	} = $props();

	let amount = $state('');
	let occurredOn = $state('');
	let method = $state('');
	let reference = $state('');
	let note = $state('');
	let donorId = $state<string>(NO_DONOR);
	let isSaving = $state(false);
	let failure = $state<string | null>(null);

	const isEdit = $derived(transaction !== null);
	const type = $derived(transaction?.type ?? defaultType);

	const donorCollection = $derived(
		createListCollection({
			items: [
				{ value: NO_DONOR, label: m.money_noDonor() },
				...donors.map((donor) => ({ value: donor._id as string, label: contactDisplayName(donor) }))
			]
		})
	);

	$effect(() => {
		if (!open) return;
		const source = transaction;
		amount = source ? centsToDollarInput(source.amountCents) : '';
		occurredOn = source?.occurredOn ?? '';
		method = source?.method ?? '';
		reference = source?.reference ?? '';
		note = source?.note ?? '';
		donorId = source?.contactId ?? NO_DONOR;
		failure = null;
	});

	const amountCents = $derived(dollarsToCents(amount));
	const amountError = $derived(
		amount.trim() !== '' && (amountCents === null || amountCents < 0)
			? m.money_amountInvalid()
			: null
	);
	const canSubmit = $derived(amountCents !== null && amountCents >= 0);

	type UpdateArgs = {
		transactionId: Id<'transactions'>;
		amountCents?: number;
		occurredOn?: string;
		method?: string;
		reference?: string;
		note?: string;
		contactId?: Id<'contacts'>;
		clearContact?: boolean;
	};

	function selectedDonor(): Id<'contacts'> | null {
		if (type !== 'donation' || donorId === NO_DONOR) return null;
		return donorId as Id<'contacts'>;
	}

	function buildUpdate(source: Transaction, cents: number): UpdateArgs {
		// Every optional on updateTransaction is omitted-means-unchanged, so only
		// the fields the user actually moved are sent.
		const args: UpdateArgs = { transactionId: source._id };
		if (cents !== source.amountCents) args.amountCents = cents;
		if (occurredOn.trim() !== (source.occurredOn ?? '')) args.occurredOn = occurredOn.trim();
		if (method.trim() !== (source.method ?? '')) args.method = method.trim();
		if (reference.trim() !== (source.reference ?? '')) args.reference = reference.trim();
		if (note.trim() !== (source.note ?? '')) args.note = note.trim();

		const nextDonor = selectedDonor();
		const currentDonor = source.contactId ?? null;
		if (nextDonor !== currentDonor) {
			// contactId and clearContact are mutually exclusive server-side.
			if (nextDonor === null) {
				args.clearContact = true;
			} else {
				args.contactId = nextDonor;
			}
		}

		return args;
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const cents = amountCents;
		if (isSaving || cents === null || cents < 0) return;

		isSaving = true;
		failure = null;
		try {
			if (transaction) {
				await client.mutation(
					api.transactions.mutations.updateTransaction,
					buildUpdate(transaction, cents)
				);
			} else {
				await client.mutation(api.transactions.mutations.createTransaction, {
					type,
					amountCents: cents,
					occurredOn: occurredOn.trim() || undefined,
					method: method.trim() || undefined,
					reference: reference.trim() || undefined,
					note: note.trim() || undefined,
					contactId: selectedDonor() ?? undefined
				});
				toast.success(m.money_transactionCreated());
			}
			open = false;
		} catch (error: unknown) {
			// The server refuses an amount below what is already allocated. The
			// dialog stays open so that reason is read instead of flashing past.
			failure =
				error instanceof ConvexError
					? String(error.data)
					: error instanceof Error
						? error.message
						: m.state_saveFailed();
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-lg">
		<Dialog.Header class="w-full">
			<Dialog.Title>{isEdit ? m.money_editTransaction() : newTransactionTitle(type)}</Dialog.Title>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<AmountField id="transaction-amount" bind:value={amount} error={amountError} />

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="transaction-date">{m.money_occurredOn()}</Label>
					<Input id="transaction-date" type="date" bind:value={occurredOn} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="transaction-method">{m.money_method()}</Label>
					<Input id="transaction-method" bind:value={method} />
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="transaction-reference">{m.money_reference()}</Label>
				<Input id="transaction-reference" bind:value={reference} />
			</div>

			{#if type === 'donation'}
				<div class="flex flex-col gap-1.5">
					<Label>{m.money_donor()}</Label>
					<Select.Root
						collection={donorCollection}
						value={[donorId]}
						onValueChange={(details: { value: string[] }): void => {
							const next = details.value[0];
							if (next) donorId = next;
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
				</div>
			{/if}

			<div class="flex flex-col gap-1.5">
				<Label for="transaction-note">{m.field_notes()}</Label>
				<Input id="transaction-note" bind:value={note} />
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
					{isEdit ? m.action_save() : m.action_create()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
