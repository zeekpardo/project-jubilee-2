<script lang="ts">
	// The table. Rows arrive already filtered AND sorted by `listTasks`; nothing
	// here re-filters or re-sorts, because the server had to apply the leftover
	// filters anyway (the assignee one needs a db read) and two sorts that
	// disagree is a bug waiting for a tie.

	// Primitives
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Checkbox } from '$lib/primitives/ui/checkbox';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import * as Table from '$lib/primitives/ui/table';
	import type { BadgeVariant } from '$lib/primitives/ui/badge';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import { isOverdue } from './filters';
	import type { SortDir, TaskPriority, TaskSortKey, TaskStatus } from './types';
	import type { TaskRow } from './rows';
	import * as m from '$lib/i18n/messages';

	let {
		tasks,
		scope,
		today,
		sort,
		dir,
		onSort,
		selected,
		onToggle,
		onToggleAll,
		onOpen,
		onDelete,
		canWrite,
		recordLabel,
		loading = false
	}: {
		tasks: TaskRow[];
		scope: 'campaign' | 'org';
		/**
		 * The record column's heading. The campaign page passes that campaign's own
		 * word — "Family" at Jubilee — and only the org-wide page, which spans
		 * campaigns that each name it differently, falls back to the generic one.
		 */
		recordLabel: string;
		/** ISO `YYYY-MM-DD` in the VIEWER's timezone — see TaskListView. */
		today: string;
		sort: TaskSortKey;
		dir: SortDir;
		onSort: (key: TaskSortKey) => void;
		selected: Set<string>;
		onToggle: (taskId: string, checked: boolean) => void;
		onToggleAll: (checked: boolean) => void;
		onOpen: (task: TaskRow) => void;
		onDelete: (task: TaskRow) => void;
		/** Per campaign, because an org-wide list spans campaigns a team leader only partly holds. */
		canWrite: (campaignId: string) => boolean;
		loading?: boolean;
	} = $props();

	const PRIORITY_VARIANT: Record<TaskPriority, BadgeVariant> = {
		low: 'outline',
		normal: 'secondary',
		high: 'warning',
		urgent: 'destructive'
	};

	const PRIORITY_LABEL: Record<TaskPriority, () => string> = {
		low: m.taskPriority_low,
		normal: m.taskPriority_normal,
		high: m.taskPriority_high,
		urgent: m.taskPriority_urgent
	};

	const STATUS_LABEL: Record<TaskStatus, () => string> = {
		todo: m.taskStatus_todo,
		done: m.taskStatus_done
	};

	// The record column is not in this list because its heading is the campaign's
	// own word rather than a message, and it sits after Stage in the table.
	const columns: { key: TaskSortKey; label: () => string }[] = [
		{ key: 'label', label: m.taskList_colTask },
		{ key: 'assignee', label: m.taskList_colAssignee },
		{ key: 'dueOn', label: m.taskList_colDue },
		{ key: 'priority', label: m.taskList_colPriority },
		{ key: 'status', label: m.taskList_colStatus }
	];

	// Only rows the viewer may write are selectable, so a bulk action can never
	// be assembled out of rows the server will refuse.
	const selectable = $derived(tasks.filter((task) => canWrite(task.campaignId)));
	const allSelected = $derived(
		selectable.length > 0 && selectable.every((task) => selected.has(task._id))
	);
	const someSelected = $derived(selectable.some((task) => selected.has(task._id)));

	function ariaSort(key: TaskSortKey): 'ascending' | 'descending' | 'none' {
		if (sort !== key) return 'none';
		return dir === 'asc' ? 'ascending' : 'descending';
	}
</script>

{#snippet sortableHead(key: TaskSortKey, label: string)}
	<Table.Head aria-sort={ariaSort(key)}>
		<button
			type="button"
			class="hover:text-foreground -mx-1 flex items-center gap-1 rounded px-1 whitespace-nowrap"
			aria-label={m.taskList_sortBy({ column: label })}
			onclick={() => onSort(key)}
		>
			{label}
			{#if sort === key}
				{#if dir === 'asc'}
					<ArrowUpIcon class="size-3.5" aria-hidden="true" />
				{:else}
					<ArrowDownIcon class="size-3.5" aria-hidden="true" />
				{/if}
			{/if}
		</button>
	</Table.Head>
{/snippet}

<!-- The TABLE scrolls sideways, never the page body: a narrow viewport should
     not push the nav off-screen to reach a due date. -->
<div class="overflow-x-auto rounded-lg border">
	<Table.Root>
		<Table.Header class="bg-muted">
			<Table.Row>
				<Table.Head class="w-1">
					<Checkbox
						checked={allSelected ? true : someSelected ? 'indeterminate' : false}
						disabled={selectable.length === 0}
						aria-label={m.taskList_selectAll()}
						onCheckedChange={(details) => onToggleAll(details.checked === true)}
					/>
				</Table.Head>
				{#each columns as column (column.key)}
					{@render sortableHead(column.key, column.label())}
				{/each}
				<Table.Head>{m.taskList_colStage()}</Table.Head>
				{@render sortableHead('project', recordLabel)}
				{#if scope === 'org'}
					<Table.Head>{m.taskList_colCampaign()}</Table.Head>
				{/if}
				<Table.Head class="w-1 text-right">{m.field_actions()}</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#if loading}
				<!-- Skeletons in the BODY only: the header and filter bar are already
				     correct, and replacing them would make the page jump. -->
				{#each [0, 1, 2, 3, 4] as row (row)}
					<Table.Row>
						<Table.Cell colspan={scope === 'org' ? 9 : 8}>
							<Skeleton class="h-6 w-full" />
						</Table.Cell>
					</Table.Row>
				{/each}
			{:else}
				{#each tasks as task (task._id)}
					{@const overdue = isOverdue(task, today)}
					{@const writable = canWrite(task.campaignId)}
					<Table.Row data-state={selected.has(task._id) ? 'selected' : undefined}>
						<Table.Cell>
							<Checkbox
								checked={selected.has(task._id)}
								disabled={!writable}
								aria-label={m.taskList_selectRow({ label: task.label })}
								onCheckedChange={(details) => onToggle(task._id, details.checked === true)}
							/>
						</Table.Cell>
						<Table.Cell class="font-medium">
							<button
								type="button"
								class="flex max-w-xs items-center gap-2 text-left hover:underline"
								aria-label={m.taskList_openRow({ label: task.label })}
								onclick={() => onOpen(task)}
							>
								{#if task.source === 'template'}
									<ListChecksIcon
										class="text-muted-foreground size-3.5 shrink-0"
										aria-label={m.taskSheet_fromTemplate()}
									/>
								{/if}
								<span
									class="truncate"
									class:line-through={task.status === 'done'}
									class:text-muted-foreground={task.status === 'done'}
								>
									{task.label}
								</span>
							</button>
						</Table.Cell>
						<Table.Cell class="text-muted-foreground whitespace-nowrap">
							{task.assigneeName ?? m.taskList_unassigned()}
						</Table.Cell>
						<Table.Cell class="whitespace-nowrap tabular-nums">
							{#if task.dueOn}
								<span class:text-destructive={overdue}>{task.dueOn}</span>
								{#if overdue}
									<Badge variant="destructive" class="ms-2">{m.taskList_overdue()}</Badge>
								{/if}
							{:else}
								<span class="text-muted-foreground">—</span>
							{/if}
						</Table.Cell>
						<Table.Cell>
							<Badge variant={PRIORITY_VARIANT[task.priority]}>
								{PRIORITY_LABEL[task.priority]()}
							</Badge>
						</Table.Cell>
						<Table.Cell>
							<Badge variant={task.status === 'done' ? 'success' : 'outline'}>
								{STATUS_LABEL[task.status]()}
							</Badge>
						</Table.Cell>
						<Table.Cell class="text-muted-foreground">{task.stageLabel ?? '—'}</Table.Cell>
						<Table.Cell class="text-muted-foreground whitespace-nowrap">
							{#if task.projectNumber}
								{task.projectNumber}
							{:else}
								<span class="text-xs">{m.taskList_campaignLevel()}</span>
							{/if}
						</Table.Cell>
						{#if scope === 'org'}
							<Table.Cell class="text-muted-foreground">{task.campaignName ?? '—'}</Table.Cell>
						{/if}
						<Table.Cell class="text-right whitespace-nowrap">
							{#if writable}
								<Button
									size="icon"
									variant="ghost"
									aria-label={m.taskList_deleteTitle()}
									onclick={() => onDelete(task)}
								>
									<Trash2Icon />
								</Button>
							{/if}
						</Table.Cell>
					</Table.Row>
				{/each}
			{/if}
		</Table.Body>
	</Table.Root>
</div>
