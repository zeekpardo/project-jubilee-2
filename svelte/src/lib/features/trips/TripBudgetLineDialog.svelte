<script lang="ts">
	// One planned cost. Amounts are typed in dollars and stored as integer cents,
	// parsed on the STRING through the shared helper so a third decimal place is
	// rejected outright rather than silently rounded into a trip budget.
	//
	// A planned figure of zero is legal — a donated seat is still a line worth
	// listing — so this is the non-negative check and not the positive one the
	// spend dialog uses.

	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Switch } from '$lib/primitives/ui/switch';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import { centsToDollarInput, dollarsToCents } from '$lib/features/settings/amount';
	import * as m from '$lib/i18n/messages';
	import type { TripBudgetLineRow } from './types';

	let {
		open = $bindable(false),
		tripId,
		line = null
	}: {
		open?: boolean;
		tripId: Id<'trips'>;
		/** Null adds a line, a row edits it. */
		line?: TripBudgetLineRow | null;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const isEdit = $derived(line !== null);

	let label = $state('');
	let amount = $state('');
	let perAttendee = $state(false);
	let notes = $state('');
	let isSaving = $state(false);

	$effect(() => {
		if (!open) return;
		const source = line;
		label = source?.label ?? '';
		amount = source ? centsToDollarInput(source.amountCents) : '';
		perAttendee = source?.perAttendee ?? false;
		notes = source?.notes ?? '';
	});

	const amountCents = $derived.by(() => {
		const cents = dollarsToCents(amount);
		return cents === null || cents < 0 ? null : cents;
	});
	const amountError = $derived(
		amount.trim() !== '' && amountCents === null ? m.tripDetail_lineAmountInvalid() : null
	);
	const canSubmit = $derived(label.trim() !== '' && amountCents !== null);

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit || amountCents === null) return;
		isSaving = true;

		try {
			if (line) {
				await client.mutation(api.tripBudgetLines.mutations.updateTripBudgetLine, {
					lineId: line._id,
					label: label.trim(),
					amountCents,
					perAttendee,
					// `null` clears the note; an absent argument would leave the old one.
					notes: notes.trim() || null
				});
			} else {
				await client.mutation(api.tripBudgetLines.mutations.createTripBudgetLine, {
					tripId,
					label: label.trim(),
					amountCents,
					perAttendee,
					notes: notes.trim() || undefined
				});
			}
			open = false;
		} catch (error: unknown) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-md">
		<Dialog.Header class="w-full">
			<Dialog.Title>{isEdit ? m.tripDetail_editLine() : m.tripDetail_addLine()}</Dialog.Title>
		</Dialog.Header>

		<form class="flex w-full flex-col gap-4" onsubmit={handleSubmit}>
			<div class="flex flex-col gap-2">
				<Label for="budget-line-label">{m.tripDetail_lineLabel()}</Label>
				<Input
					id="budget-line-label"
					bind:value={label}
					placeholder={m.tripDetail_lineLabelPlaceholder()}
					required
					autocomplete="off"
				/>
			</div>

			<div class="flex flex-col gap-2">
				<Label for="budget-line-amount">{m.field_amount()}</Label>
				<Input
					id="budget-line-amount"
					bind:value={amount}
					inputmode="decimal"
					placeholder="0.00"
					required
					autocomplete="off"
				/>
				{#if amountError}
					<p class="text-destructive text-xs">{amountError}</p>
				{/if}
			</div>

			<div class="flex flex-col gap-2">
				<Switch bind:checked={perAttendee}>{m.tripDetail_linePerAttendee()}</Switch>
				<p class="text-muted-foreground text-xs">{m.tripDetail_linePerAttendeeHelp()}</p>
			</div>

			<div class="flex flex-col gap-2">
				<Label for="budget-line-notes">{m.field_notes()}</Label>
				<Textarea id="budget-line-notes" bind:value={notes} rows={2} />
			</div>

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
