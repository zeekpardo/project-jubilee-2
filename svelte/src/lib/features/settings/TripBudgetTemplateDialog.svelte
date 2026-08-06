<script lang="ts">
	// Create or edit a named budget preset.
	//
	// Edited IN PLACE, unlike the cost and task template dialogs beside it. Those
	// are append-only because a project budget and a ticked checklist item must
	// not be rewritten by a later edit to their source. A preset has no such
	// duty: applying it copies its lines onto the trip, so no trip is downstream
	// of it. See `tripBudgetTemplates` in schema.ts.

	import * as Dialog from '$lib/primitives/ui/dialog';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Switch } from '$lib/primitives/ui/switch';
	import type { SwitchCheckedChangeDetails } from '$lib/primitives/ui/switch';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import type { TripBudgetTemplate } from './types';
	import { dollarsToCents, centsToDollarInput } from './amount';
	import * as m from '$lib/i18n/messages';

	let {
		open = $bindable(false),
		campaignId,
		template = null
	}: {
		open?: boolean;
		campaignId: Id<'campaigns'>;
		/** Null creates; a template edits that one in place. */
		template?: TripBudgetTemplate | null;
	} = $props();

	type Row = {
		id: number;
		label: string;
		/** Dollars as typed. Converted to integer cents once, on save. */
		amount: string;
		perAttendee: boolean;
	};

	let nextRowId = 0;
	let name = $state('');
	let rows = $state<Row[]>([]);
	let isSaving = $state(false);

	function blankRow(): Row {
		nextRowId += 1;
		return { id: nextRowId, label: '', amount: '', perAttendee: false };
	}

	$effect(() => {
		if (!open) return;
		const source = template;
		name = source?.name ?? '';
		rows = source
			? [...source.lines]
					.sort((a, b) => a.order - b.order)
					.map((line) => {
						nextRowId += 1;
						return {
							id: nextRowId,
							label: line.label,
							amount: centsToDollarInput(line.amountCents),
							perAttendee: line.perAttendee
						};
					})
			: [blankRow()];
	});

	// A row counts once it has a label AND a parseable amount. A half-typed row
	// at the bottom is the normal state of this form, not an error to shout at.
	const filled = $derived(
		rows.filter((row) => row.label.trim() !== '' && dollarsToCents(row.amount) !== null)
	);
	const canSubmit = $derived(name.trim() !== '' && filled.length > 0 && !isSaving);

	function addRow(): void {
		rows = [...rows, blankRow()];
	}

	function removeRow(id: number): void {
		rows = rows.filter((row) => row.id !== id);
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;

		const lines = filled.map((row, index) => ({
			label: row.label.trim(),
			// Non-null by construction: `filled` already dropped anything unparseable.
			amountCents: dollarsToCents(row.amount) as number,
			perAttendee: row.perAttendee,
			order: index
		}));

		isSaving = true;
		try {
			if (template) {
				await client.mutation(api.tripBudgetTemplates.mutations.updateTripBudgetTemplate, {
					templateId: template._id,
					name: name.trim(),
					lines
				});
			} else {
				await client.mutation(api.tripBudgetTemplates.mutations.createTripBudgetTemplate, {
					campaignId,
					name: name.trim(),
					lines
				});
			}
			toast.success(m.state_saved());
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

	const { api } = getAuthContext();
	const client = useConvexClient();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>
				{template ? m.settings_tripBudgetEdit() : m.settings_tripBudgetNew()}
			</Dialog.Title>
			<Dialog.Description>{m.settings_tripBudgetHelp()}</Dialog.Description>
		</Dialog.Header>

		<form class="flex flex-col gap-4" onsubmit={handleSubmit}>
			<div class="flex flex-col gap-2">
				<Label for="trip-budget-name">{m.settings_tripBudgetName()}</Label>
				<Input
					id="trip-budget-name"
					bind:value={name}
					placeholder={m.settings_tripBudgetNamePlaceholder()}
					required
				/>
			</div>

			<div class="flex flex-col gap-2">
				<div
					class="text-muted-foreground flex items-center gap-2 text-[11px] font-medium tracking-wide uppercase"
				>
					<span class="flex-1">{m.settings_tripBudgetLineLabel()}</span>
					<span class="w-32 shrink-0">{m.money_amount()}</span>
					<span class="w-28 shrink-0 text-center">{m.settings_perAttendeeShort()}</span>
					<span class="w-9 shrink-0"></span>
				</div>

				{#each rows as row (row.id)}
					<div class="flex items-center gap-2">
						<Input
							bind:value={row.label}
							placeholder={m.settings_tripBudgetLinePlaceholder()}
							aria-label={m.settings_tripBudgetLineLabel()}
						/>
						<Input
							bind:value={row.amount}
							class="w-32 shrink-0 tabular-nums"
							inputmode="decimal"
							placeholder="0.00"
							aria-label={m.money_amount()}
						/>
						<div class="flex w-28 shrink-0 justify-center">
							<Switch
								checked={row.perAttendee}
								aria-label={m.settings_perAttendee()}
								title={m.settings_perAttendeeMoneyHelp()}
								onCheckedChange={(details: SwitchCheckedChangeDetails): void => {
									row.perAttendee = details.checked;
								}}
							/>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label={m.action_delete()}
							title={m.action_delete()}
							disabled={rows.length === 1}
							onclick={() => removeRow(row.id)}
						>
							<Trash2Icon />
						</Button>
					</div>
				{/each}

				<div>
					<Button type="button" variant="outline" size="sm" onclick={addRow}>
						<PlusIcon />
						{m.settings_tripBudgetAddLine()}
					</Button>
				</div>
			</div>

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={!canSubmit}>{m.action_save()}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
