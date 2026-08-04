<script lang="ts">
	// Trip money: PLANNED ONLY, deliberately (§7). Nothing on this screen reads
	// `transactions` or `allocations` — the `allocations.tripId` that would
	// attribute real spend to a trip is specified and not built, so the actuals
	// panel ships as an empty state and integration later is a data-source swap
	// rather than a redesign. `buildTripBudget` already takes the allocation rows
	// a future `by_tripId` query will hand it; today that argument is `[]`.
	//
	// NO ARITHMETIC HERE. The per-seat multiplication, the subtotals and the total
	// all come from the pure, tested `lib/domain/trip-budget.ts`, so the figure on
	// this page and the figure in the tests are the same figure.

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ReceiptTextIcon from '@lucide/svelte/icons/receipt-text';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import WalletIcon from '@lucide/svelte/icons/wallet';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc } from '$convex/_generated/dataModel';

	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import { formatCents } from '$lib/features/money/format';
	import { buildTripBudget } from '$lib/domain/trip-budget';
	import * as m from '$lib/i18n/messages';
	import TripBudgetLineDialog from './TripBudgetLineDialog.svelte';
	import type { TripBudgetLineRow } from './types';

	let { trip, canWrite }: { trip: Doc<'trips'>; canWrite: boolean } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const linesResponse = useQuery(api.tripBudgetLines.queries.listTripBudgetLines, () => ({
		tripId: trip._id
	}));
	const lines = $derived(linesResponse.data ?? []);

	const attendeesResponse = useQuery(api.tripAttendees.queries.listTripAttendees, () => ({
		tripId: trip._id
	}));
	// CONFIRMED only. A per-seat line plans against the people who have actually
	// said yes; counting invitations would inflate the budget by everyone who
	// was asked.
	const confirmedCount = $derived(
		(attendeesResponse.data ?? []).filter((attendee) => attendee.status === 'confirmed').length
	);

	const ordered = $derived([...lines].sort((a, b) => a.order - b.order));

	const ledger = $derived(
		buildTripBudget(
			ordered.map((line) => ({
				label: line.label,
				amountCents: line.amountCents,
				perAttendee: line.perAttendee,
				order: line.order
			})),
			// The ledger side of §7, deliberately absent.
			[],
			confirmedCount,
			m.tripDetail_unassigned()
		)
	);

	// `buildTripBudget` returns one row per line in the same order it was handed
	// them, so index pairs a row back to the document the actions need. The
	// synthetic "Unassigned" row has no document and is not pairable — it cannot
	// appear while allocations are `[]`, and the filter keeps that true if they
	// ever are not.
	const rows = $derived(
		ledger.rows
			.filter((row) => row.group === 'line')
			.map((row, index) => ({ row, line: ordered[index] ?? null }))
	);

	let dialogOpen = $state(false);
	let editing = $state<TripBudgetLineRow | null>(null);
	let removeOpen = $state(false);
	let removing = $state<TripBudgetLineRow | null>(null);

	function openAdd(): void {
		editing = null;
		dialogOpen = true;
	}

	function openEdit(line: TripBudgetLineRow): void {
		editing = line;
		dialogOpen = true;
	}

	function openRemove(line: TripBudgetLineRow): void {
		removing = line;
		removeOpen = true;
	}

	async function removeLine(): Promise<void> {
		const target = removing;
		if (!target) return;
		await client.mutation(api.tripBudgetLines.mutations.deleteTripBudgetLine, {
			lineId: target._id
		});
	}
</script>

<div class="flex flex-col gap-4">
	<Card.Root>
		<Card.Header>
			<Card.Title>{m.tripDetail_planned()}</Card.Title>
			<Card.Description>
				{m.tripDetail_confirmedRoster({ count: ledger.attendeeCount })}
			</Card.Description>
			{#if canWrite}
				<Card.Action>
					<Button variant="outline" size="sm" onclick={openAdd}>
						<PlusIcon class="size-4" aria-hidden="true" />
						{m.tripDetail_addLine()}
					</Button>
				</Card.Action>
			{/if}
		</Card.Header>
		<Card.Content>
			{#if linesResponse.isLoading}
				<div class="flex flex-col gap-3">
					<Skeleton class="h-8 w-full" />
					<Skeleton class="h-8 w-full" />
				</div>
			{:else if rows.length === 0}
				<EmptyState
					size="sm"
					variant="plain"
					title={m.tripDetail_noLines()}
					description={m.tripDetail_noLinesBody()}
				>
					{#snippet icon()}
						<WalletIcon />
					{/snippet}
				</EmptyState>
			{:else}
				<Table.Root>
					<Table.Header class="bg-muted">
						<Table.Row>
							<Table.Head>{m.tripDetail_lineLabel()}</Table.Head>
							<Table.Head class="text-right">{m.field_amount()}</Table.Head>
							<Table.Head class="text-right">{m.tripDetail_lineTotal()}</Table.Head>
							<Table.Head class="w-24 text-right">{m.field_actions()}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						<!-- Keyed on `rowId`, not on the label: two lines may legitimately
						     carry the same label, and `group` is what disambiguates. -->
						{#each rows as entry (entry.row.rowId)}
							<Table.Row>
								<Table.Cell>
									<div class="flex flex-col">
										<span class="flex items-center gap-2 font-medium">
											{entry.row.label}
											{#if entry.row.perAttendee}
												<Badge variant="outline">{m.tripDetail_linePerAttendee()}</Badge>
											{/if}
										</span>
										{#if entry.line?.notes}
											<span class="text-muted-foreground text-xs">{entry.line.notes}</span>
										{/if}
									</div>
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">
									{formatCents(entry.row.unitAmountCents)}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">
									{formatCents(entry.row.plannedCents)}
								</Table.Cell>
								<Table.Cell class="text-right">
									{#if canWrite && entry.line}
										{@const line = entry.line}
										<div class="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="icon"
												aria-label={m.tripDetail_editLine()}
												title={m.tripDetail_editLine()}
												onclick={() => openEdit(line)}
											>
												<PencilIcon class="size-4" aria-hidden="true" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												aria-label={m.tripDetail_removeLine()}
												title={m.tripDetail_removeLine()}
												onclick={() => openRemove(line)}
											>
												<Trash2Icon class="size-4" aria-hidden="true" />
											</Button>
										</div>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
					<Table.Footer>
						<Table.Row>
							<!-- The per-person subtotal is the sum of the per-seat QUOTES, not
							     total ÷ roster: what a coordinator needs when somebody asks
							     "can we bring one more" is the marginal number. -->
							<Table.Cell colspan={2}>{m.tripDetail_perPersonSubtotal()}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{formatCents(ledger.perAttendeeAmountCents)}
							</Table.Cell>
							<Table.Cell></Table.Cell>
						</Table.Row>
						<Table.Row>
							<Table.Cell colspan={2}>{m.tripDetail_fixedSubtotal()}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{formatCents(ledger.fixedAmountCents)}
							</Table.Cell>
							<Table.Cell></Table.Cell>
						</Table.Row>
						<Table.Row>
							<Table.Cell colspan={2} class="font-medium">
								{m.tripDetail_plannedTotal()}
							</Table.Cell>
							<Table.Cell class="text-right font-medium tabular-nums">
								{formatCents(ledger.totalPlannedCents)}
							</Table.Cell>
							<Table.Cell></Table.Cell>
						</Table.Row>
					</Table.Footer>
				</Table.Root>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>{m.tripDetail_actuals()}</Card.Title>
		</Card.Header>
		<Card.Content>
			<!-- Built now, filled later. §7 keeps every ledger edit out of this
			     worktree, so what ships is the panel and its layout — not a number
			     nothing computes yet. -->
			<EmptyState
				size="sm"
				variant="plain"
				title={m.tripDetail_actualsEmpty()}
				description={m.tripDetail_actualsEmptyBody()}
			>
				{#snippet icon()}
					<ReceiptTextIcon />
				{/snippet}
			</EmptyState>
		</Card.Content>
	</Card.Root>
</div>

{#key editing?._id ?? 'new'}
	<TripBudgetLineDialog bind:open={dialogOpen} tripId={trip._id} line={editing} />
{/key}

<ConfirmDialog
	bind:open={removeOpen}
	title={m.tripDetail_removeLine()}
	body={m.tripDetail_removeLineBody()}
	confirmLabel={m.action_remove()}
	onConfirm={removeLine}
/>
