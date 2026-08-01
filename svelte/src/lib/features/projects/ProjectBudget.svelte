<script lang="ts">
	import * as Card from '$lib/primitives/ui/card';
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { cn } from '$lib/primitives/utils';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc } from '$convex/_generated/dataModel';

	import { Can } from '$lib/access';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import * as m from '$lib/i18n/messages';
	import {
		buildBudgetLedger,
		humanizeBudgetKey,
		type ActualAllocation,
		type FixedItem,
		type LedgerRow
	} from '$lib/domain/budget-actuals';
	import { formatCents } from './format';
	import { useProjectExpenditures } from './money.svelte';
	import ProjectBudgetDialog from './ProjectBudgetDialog.svelte';

	let {
		project,
		budget,
		isLoading
	}: {
		project: Doc<'projects'>;
		budget: Doc<'budgets'> | null;
		isLoading: boolean;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let dialogOpen = $state(false);
	let deleteOpen = $state(false);

	// Actual comes from real expenditures allocated to this project's fund —
	// never from donations (that is Raised) and never from transfers.
	const spend = useProjectExpenditures(() => project._id);
	const allocationRows = $derived<ActualAllocation[]>(
		spend.expenditures.map((row) => ({ budgetItem: row.budgetItem, amountCents: row.amountCents }))
	);

	const fixedItems = $derived<FixedItem[]>(
		Object.keys(budget?.templateSnapshot ?? {}).map((key) => ({
			key,
			label: humanizeBudgetKey(key)
		}))
	);

	const ledger = $derived(
		buildBudgetLedger(
			{
				templateSnapshot: budget?.templateSnapshot ?? {},
				debtCents: budget?.debtCents ?? 0,
				extras: budget?.extras ?? []
			},
			allocationRows,
			fixedItems,
			'debt',
			m.projects_debt(),
			m.projects_budgetUnassigned()
		)
	);

	// Lines with nothing budgeted and nothing spent stay hidden; the full rate
	// card is always available in the edit dialog.
	const rows = $derived(
		ledger.rows.filter((row) => row.budgetedCents > 0 || row.actualCents > 0 || row.proofCount > 0)
	);

	async function deleteBudget(): Promise<void> {
		if (!budget) return;
		await client.mutation(api.budgets.mutations.deleteBudget, { budgetId: budget._id });
	}
</script>

{#snippet delta(row: LedgerRow)}
	{#if row.budgetedCents === 0 && row.actualCents === 0}
		<span class="text-muted-foreground/50">—</span>
	{:else}
		{@const over = row.deltaCents > 0}
		{@const pct = row.ratio === null ? null : Math.round(row.ratio * 100)}
		<div class="flex flex-col items-end leading-tight">
			<span
				class={cn(
					'tabular-nums',
					over ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'
				)}
			>
				{over ? '+' : ''}{formatCents(row.deltaCents)}
			</span>
			<span class="text-muted-foreground text-[11px] tabular-nums">
				{#if pct === null}
					{row.actualCents > 0 ? m.projects_budgetNoBudget() : '—'}
				{:else}
					{m.projects_budgetPercentOfBudget({ percent: pct })}
				{/if}
			</span>
		</div>
	{/if}
{/snippet}

<Card.Root>
	<Card.Header>
		<Card.Title>{m.projects_lineItems()}</Card.Title>
		{#if budget}
			<Card.Description class="font-mono text-xs">{budget.templateVersion}</Card.Description>
			<Can do="projects:write" campaignId={project.campaignId}>
				<Card.Action>
					<div class="flex items-center gap-1">
						<Button variant="outline" size="sm" onclick={() => (dialogOpen = true)}>
							<PencilIcon class="size-4" aria-hidden="true" />
							{m.projects_budgetEdit()}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							aria-label={m.projects_budgetDeleteTitle()}
							title={m.projects_budgetDeleteTitle()}
							onclick={() => (deleteOpen = true)}
						>
							<Trash2Icon class="size-4" aria-hidden="true" />
						</Button>
					</div>
				</Card.Action>
			</Can>
		{/if}
	</Card.Header>
	<Card.Content>
		{#if isLoading || spend.isLoading}
			<div class="flex flex-col gap-3">
				<Skeleton class="h-6 w-full" />
				<Skeleton class="h-6 w-full" />
				<Skeleton class="h-6 w-full" />
			</div>
		{:else if !budget}
			<EmptyState variant="plain" size="sm" title={m.projects_budgetNone()}>
				{#snippet action()}
					<Can do="projects:write" campaignId={project.campaignId}>
						<Button variant="outline" size="sm" onclick={() => (dialogOpen = true)}>
							<PlusIcon class="size-4" aria-hidden="true" />
							{m.projects_budgetCreate()}
						</Button>
					</Can>
				{/snippet}
			</EmptyState>
		{:else}
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header class="bg-muted">
						<Table.Row>
							<Table.Head>{m.field_name()}</Table.Head>
							<Table.Head class="text-right">{m.projects_budgetBudgeted()}</Table.Head>
							<Table.Head class="text-right">{m.projects_budgetActual()}</Table.Head>
							<Table.Head class="text-right">{m.projects_budgetDelta()}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each rows as row (row.key)}
							<Table.Row>
								<Table.Cell class={cn(row.group === 'fixed' && 'capitalize')}>
									{row.label}
									{#if row.group === 'extra'}
										<Badge variant="outline" class="ml-2 rounded-sm text-[10px]">
											{m.projects_budgetExtraBadge()}
										</Badge>
									{:else if row.group === 'unassigned'}
										<Badge variant="secondary" class="ml-2 rounded-sm text-[10px]">
											{m.projects_budgetUntagged()}
										</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">
									{formatCents(row.budgetedCents)}
								</Table.Cell>
								<Table.Cell class="text-right font-medium tabular-nums">
									{#if row.actualCents > 0}
										{formatCents(row.actualCents)}
									{:else}
										<span class="text-muted-foreground/50">{formatCents(0)}</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right">
									{@render delta(row)}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
					<Table.Footer>
						<Table.Row>
							<Table.Cell class="font-medium">{m.projects_budgetTotal()}</Table.Cell>
							<Table.Cell class="text-right font-medium tabular-nums">
								{formatCents(ledger.totalBudgetedCents)}
							</Table.Cell>
							<Table.Cell class="text-right font-medium tabular-nums">
								{formatCents(ledger.totalActualCents)}
							</Table.Cell>
							<Table.Cell class="text-right">
								<div class="flex flex-col items-end leading-tight">
									<span class="text-muted-foreground text-[11px]">
										{m.projects_budgetUnspent()}
									</span>
									<span
										class={cn(
											'font-medium tabular-nums',
											ledger.remainingCents < 0 && 'text-amber-700 dark:text-amber-400'
										)}
									>
										{formatCents(ledger.remainingCents)}
									</span>
								</div>
							</Table.Cell>
						</Table.Row>
					</Table.Footer>
				</Table.Root>
			</div>
		{/if}
	</Card.Content>
</Card.Root>

<ProjectBudgetDialog
	bind:open={dialogOpen}
	projectId={project._id}
	campaignId={project.campaignId}
	{budget}
/>

<ConfirmDialog
	bind:open={deleteOpen}
	title={m.projects_budgetDeleteTitle()}
	body={m.projects_budgetDeleteBody()}
	onConfirm={deleteBudget}
/>
