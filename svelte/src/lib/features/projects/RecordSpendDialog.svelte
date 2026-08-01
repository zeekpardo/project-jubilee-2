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

	import AmountField from '$lib/features/money/AmountField.svelte';
	import { positiveDollarsToCents } from '$lib/features/settings/amount';
	import * as m from '$lib/i18n/messages';

	let {
		open = $bindable(false),
		projectId,
		campaignId,
		lines,
		budgetItem: initialBudgetItem = ''
	}: {
		open?: boolean;
		projectId: Id<'projects'>;
		campaignId: Id<'campaigns'>;
		/** Selectable budget lines — the ledger's real rows, never "Unassigned". */
		lines: { key: string; label: string }[];
		/** The row the dialog was opened from; pre-selects that line. */
		budgetItem?: string;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	// Matches the reference app's MAX_UPLOAD_BYTES.
	const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

	let budgetItem = $state('');
	let amount = $state('');
	let occurredOn = $state('');
	let method = $state('');
	let reference = $state('');
	let receipt = $state<File | null>(null);
	let receiptInput = $state<HTMLInputElement | null>(null);
	let isSaving = $state(false);
	let failure = $state<string | null>(null);

	$effect(() => {
		if (!open) return;
		budgetItem = initialBudgetItem;
		amount = '';
		occurredOn = '';
		method = '';
		reference = '';
		receipt = null;
		// The element keeps its own selection, so clearing the state is not
		// enough — a re-opened dialog would still show the last file's name.
		if (receiptInput) receiptInput.value = '';
		failure = null;
	});

	const collection = $derived(
		createListCollection({
			items: lines.map((line) => ({ value: line.key, label: line.label }))
		})
	);

	const lineLabel = $derived(lines.find((line) => line.key === budgetItem)?.label ?? budgetItem);

	// Dollars become cents once, here at the boundary; the mutation re-checks
	// the result is a positive integer before it reaches the ledger.
	const amountCents = $derived(amount.trim() === '' ? null : positiveDollarsToCents(amount));
	const amountError = $derived(
		amount.trim() !== '' && amountCents === null ? m.projects_spendAmountInvalid() : null
	);

	const canSubmit = $derived(amountCents !== null && budgetItem !== '');

	function handleReceiptChange(event: Event): void {
		const target = event.currentTarget as HTMLInputElement;
		receipt = target.files?.item(0) ?? null;
		if (receipt && receipt.size > MAX_UPLOAD_BYTES) {
			failure = m.projects_spendReceiptTooLarge();
		} else if (failure === m.projects_spendReceiptTooLarge()) {
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

	async function uploadReceipt(file: File): Promise<Id<'_storage'>> {
		const uploadUrl = await client.mutation(api.transactions.spend.generateReceiptUploadUrl, {
			campaignId
		});
		const response = await fetch(uploadUrl, {
			method: 'POST',
			headers: { 'Content-Type': file.type },
			body: file
		});
		// The bytes must land before the transaction points at them, so a failed
		// POST throws here instead of recording spend with a dangling receipt.
		if (!response.ok) throw new Error(m.state_saveFailed());
		const body = (await response.json()) as { storageId: Id<'_storage'> };
		return body.storageId;
	}

	/**
	 * Take an already-uploaded receipt back out of storage. Best effort by
	 * design: this only ever runs while another error is on its way to the user,
	 * so a failure here is swallowed rather than replacing the reason the spend
	 * did not save.
	 *
	 * This closes the window between a successful upload and a failed mutation.
	 * It does NOT close every window — a closed tab, a reload, or a dropped
	 * connection in that same gap leaves the blob stranded with nothing pointing
	 * at it. Accepted: the bucket is private, the bytes are invisible to the
	 * app, and a sweeper job is more machinery than the leak is worth.
	 */
	async function discardReceipt(storageId: Id<'_storage'>): Promise<void> {
		try {
			await client.mutation(api.transactions.spend.discardReceipt, { campaignId, storageId });
		} catch {
			// Intentionally ignored — see above.
		}
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit || amountCents === null) return;

		// Checked before the upload, not after, so an oversized pick never costs
		// a round trip or leaves an orphaned blob behind.
		if (receipt && receipt.size > MAX_UPLOAD_BYTES) {
			failure = m.projects_spendReceiptTooLarge();
			return;
		}

		isSaving = true;
		failure = null;
		try {
			const receiptStorageId = receipt ? await uploadReceipt(receipt) : undefined;

			try {
				// One mutation writes the expenditure and its allocation together —
				// money in the ledger is never left attributed to nobody.
				await client.mutation(api.transactions.spend.recordProjectSpend, {
					projectId,
					campaignId,
					budgetItem,
					amountCents,
					occurredOn: occurredOn.trim() || undefined,
					method: method.trim() || undefined,
					reference: reference.trim() || undefined,
					receiptStorageId
				});
			} catch (error: unknown) {
				// The bytes landed but nothing points at them. Clean up, then let the
				// original failure through untouched — it is what the user must read.
				if (receiptStorageId) await discardReceipt(receiptStorageId);
				throw error;
			}
			toast.success(m.projects_spendSaved());
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
			<Dialog.Title>{m.projects_spendTitle({ line: lineLabel })}</Dialog.Title>
			<Dialog.Description>{m.projects_spendIntro()}</Dialog.Description>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<Label>{m.money_budgetItem()}</Label>
				<Select.Root
					{collection}
					value={budgetItem === '' ? [] : [budgetItem]}
					onValueChange={(details: { value: string[] }): void => {
						budgetItem = details.value[0] ?? budgetItem;
					}}
				>
					<Select.Trigger class="w-full" placeholder={m.money_budgetItem()} />
					<Select.Content>
						{#each collection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<AmountField id="spend-amount" bind:value={amount} error={amountError} />

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="spend-date">{m.money_occurredOn()}</Label>
					<Input id="spend-date" type="date" bind:value={occurredOn} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="spend-method">{m.money_method()}</Label>
					<Input id="spend-method" bind:value={method} autocomplete="off" />
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="spend-reference">{m.money_reference()}</Label>
				<Input id="spend-reference" bind:value={reference} autocomplete="off" />
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="spend-receipt">{m.projects_spendReceipt()}</Label>
				<Input
					id="spend-receipt"
					type="file"
					accept="image/*,application/pdf"
					bind:ref={receiptInput}
					onchange={handleReceiptChange}
					class="h-auto py-1.5"
				/>
				<p class="text-muted-foreground text-xs">{m.projects_spendReceiptHelp()}</p>
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
					{m.projects_spendRecord()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
