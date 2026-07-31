<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Alert from '$lib/primitives/ui/alert';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import InfoIcon from '@lucide/svelte/icons/info';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import { dollarsToCents } from './amount';
	import { formatCents } from '$lib/features/money/format';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const client = useConvexClient();

	let { open = $bindable(false), campaignId }: { open?: boolean; campaignId: Id<'campaigns'> } =
		$props();

	type Row = { id: number; key: string; amount: string };

	let nextRowId = 0;
	let version = $state('');
	let effectiveFrom = $state('');
	let rows = $state<Row[]>([]);
	let isSaving = $state(false);

	function blankRow(): Row {
		nextRowId += 1;
		return { id: nextRowId, key: '', amount: '' };
	}

	$effect(() => {
		if (!open) return;
		version = '';
		effectiveFrom = '';
		rows = [blankRow()];
	});

	const filled = $derived(rows.filter((row) => row.key.trim() !== '' || row.amount.trim() !== ''));

	const amountsValid = $derived(
		filled.every((row) => row.key.trim() !== '' && dollarsToCents(row.amount) !== null)
	);

	const duplicateKeys = $derived.by(() => {
		const keys = filled.map((row) => row.key.trim()).filter((key) => key !== '');
		return keys.filter((key, index) => keys.indexOf(key) !== index);
	});

	const keysUnique = $derived(duplicateKeys.length === 0);

	const totalCents = $derived(
		filled.reduce((total, row) => total + (dollarsToCents(row.amount) ?? 0), 0)
	);

	const canSubmit = $derived(
		version.trim().length > 0 && filled.length > 0 && amountsValid && keysUnique
	);

	function addRow(): void {
		rows = [...rows, blankRow()];
	}

	function removeRow(id: number): void {
		rows = rows.filter((row) => row.id !== id);
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;

		const lineItems: Record<string, number> = {};
		for (const row of filled) {
			const cents = dollarsToCents(row.amount);
			// Guarded by canSubmit; the mutation rejects non-integers as well.
			if (cents === null) return;
			lineItems[row.key.trim()] = cents;
		}

		isSaving = true;
		try {
			await client.mutation(api.costTemplates.mutations.createCostTemplateVersion, {
				campaignId,
				version: version.trim(),
				lineItems,
				effectiveFrom: effectiveFrom.trim() || undefined
			});
			toast.success(m.settings_costCreated());
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
	<Dialog.Content class="md:max-w-2xl">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.settings_versionNew()}</Dialog.Title>
		</Dialog.Header>

		<Alert.Root class="w-full">
			<InfoIcon class="size-4" />
			<Alert.Description>{m.settings_appendOnlyNote()}</Alert.Description>
		</Alert.Root>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="cost-version">{m.settings_version()}</Label>
					<Input id="cost-version" bind:value={version} placeholder="2026.1" required />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="cost-effective-from">{m.settings_effectiveFrom()}</Label>
					<Input id="cost-effective-from" type="date" bind:value={effectiveFrom} />
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<Label>{m.projects_lineItems()}</Label>
				<p class="text-muted-foreground text-xs">{m.settings_amountsInDollars()}</p>

				<div class="flex flex-col gap-2">
					{#each rows as row (row.id)}
						<div class="flex items-center gap-2">
							<Input
								bind:value={row.key}
								class="font-mono"
								placeholder={m.settings_lineItemKey()}
								aria-label={m.settings_lineItemKey()}
								aria-invalid={duplicateKeys.includes(row.key.trim()) || undefined}
							/>
							<Input
								bind:value={row.amount}
								class="max-w-40 text-right tabular-nums"
								inputmode="decimal"
								placeholder={m.settings_lineItemAmount()}
								aria-label={m.settings_lineItemAmount()}
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label={m.settings_lineItemRemove()}
								title={m.settings_lineItemRemove()}
								disabled={rows.length === 1}
								onclick={() => removeRow(row.id)}
							>
								<Trash2Icon />
							</Button>
						</div>
					{/each}
				</div>

				<div class="flex items-center justify-between gap-4">
					<Button type="button" variant="outline" size="sm" onclick={addRow}>
						<PlusIcon />
						{m.settings_lineItemAdd()}
					</Button>
					<span class="text-sm font-medium tabular-nums">
						{m.settings_total()}: {formatCents(totalCents)}
					</span>
				</div>

				{#if filled.length > 0 && !amountsValid}
					<p class="text-error-700-300 text-xs">{m.settings_amountInvalid()}</p>
				{/if}
				{#if !keysUnique}
					<p class="text-error-700-300 text-xs">{m.settings_lineItemKeyDuplicate()}</p>
				{/if}
			</div>

			<Dialog.Footer class="w-full">
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || !canSubmit}>
					{m.action_create()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
