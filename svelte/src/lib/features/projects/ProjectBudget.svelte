<script lang="ts">
	import * as Card from '$lib/primitives/ui/card';
	import * as Popover from '$lib/primitives/ui/popover';
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button, buttonVariants } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { cn } from '$lib/primitives/utils';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ReceiptTextIcon from '@lucide/svelte/icons/receipt-text';
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
	import { expendituresForRow, proofSource } from './proof';
	import ProjectBudgetDialog from './ProjectBudgetDialog.svelte';
	import RecordSpendDialog from './RecordSpendDialog.svelte';

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
	let spendOpen = $state(false);
	let spendBudgetItem = $state('');

	function recordSpend(key: string): void {
		spendBudgetItem = key;
		spendOpen = true;
	}

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

	// Every real line is offered in the dialog's picker, including the ones the
	// table hides for having nothing budgeted and nothing spent. "Unassigned" is
	// not a line — you cannot deliberately record spend against untagged.
	const spendLines = $derived(
		ledger.rows
			.filter((row) => row.group !== 'unassigned')
			.map((row) => ({ key: row.key, label: row.label }))
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

<!-- The receipt link leaves the app: a signed storage URL, not a route. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
{#snippet proof(row: LedgerRow)}
	{#if row.proofCount > 0}
		<Popover.Root positioning={{ placement: 'bottom-end' }}>
			<Popover.Trigger
				class={cn(
					buttonVariants({ variant: 'ghost', size: 'sm' }),
					'text-muted-foreground h-7 gap-1 px-2 text-xs tabular-nums'
				)}
				aria-label={row.proofCount === 1
					? m.projects_proofCountOne()
					: m.projects_proofCount({ count: row.proofCount })}
			>
				<PaperclipIcon class="size-3" aria-hidden="true" />
				{row.proofCount}
			</Popover.Trigger>
			<Popover.Content class="flex flex-col gap-2 p-3 text-left">
				<p class="text-xs font-medium">{m.projects_proofTitle()}</p>
				{#each expendituresForRow(row, spend.expenditures) as item (item.allocationId)}
					{@const source = proofSource(item.method, item.reference)}
					<div class="flex flex-col gap-0.5 rounded-md border p-2 text-xs">
						<div class="flex items-center justify-between gap-2">
							<span class="text-muted-foreground">
								{item.occurredOn || m.projects_proofNoDate()}
							</span>
							<span class="font-medium tabular-nums">{formatCents(item.amountCents)}</span>
						</div>
						<span class="text-muted-foreground">{source ?? m.projects_proofNoSource()}</span>
						<!-- No receipt means no link at all — a dead placeholder would
						read as proof that is merely out of reach. -->
						{#if item.receiptUrl}
							<a
								href={item.receiptUrl}
								target="_blank"
								rel="noreferrer"
								class="text-primary inline-flex w-fit items-center gap-1 hover:underline"
							>
								<ExternalLinkIcon class="size-3" aria-hidden="true" />
								{m.projects_proofReceipt()}
							</a>
						{/if}
					</div>
				{/each}
			</Popover.Content>
		</Popover.Root>
	{:else}
		<span class="text-muted-foreground/50 text-xs">{m.projects_proofNone()}</span>
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
							<Table.Head class="text-center">{m.projects_budgetProof()}</Table.Head>
							<Table.Head class="w-0">
								<span class="sr-only">{m.projects_spendRecord()}</span>
							</Table.Head>
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
								<Table.Cell class="text-center">
									{@render proof(row)}
								</Table.Cell>
								<Table.Cell class="text-right">
									{#if row.group !== 'unassigned'}
										<Can do="money:write" campaignId={project.campaignId}>
											<Button
												variant="ghost"
												size="icon"
												class="size-7"
												aria-label={m.projects_spendFor({ line: row.label })}
												title={m.projects_spendFor({ line: row.label })}
												onclick={() => recordSpend(row.key)}
											>
												<ReceiptTextIcon class="size-4" aria-hidden="true" />
											</Button>
										</Can>
									{/if}
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
							<Table.Cell></Table.Cell>
							<Table.Cell></Table.Cell>
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

<RecordSpendDialog
	bind:open={spendOpen}
	projectId={project._id}
	campaignId={project.campaignId}
	lines={spendLines}
	budgetItem={spendBudgetItem}
/>

<ConfirmDialog
	bind:open={deleteOpen}
	title={m.projects_budgetDeleteTitle()}
	body={m.projects_budgetDeleteBody()}
	onConfirm={deleteBudget}
/>
