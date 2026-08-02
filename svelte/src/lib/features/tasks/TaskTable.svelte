<script lang="ts" module>
	/**
	 * Every column this table can render, in the ORDER it renders them. `columns`
	 * is a set, not a sequence: a surface says which columns it wants and the
	 * table decides where they sit, so three screens cannot end up with the due
	 * date in three different places.
	 */
	export const TASK_COLUMNS = [
		'select',
		'done',
		'label',
		'assignee',
		'dueOn',
		'priority',
		'status',
		'stage',
		'project',
		'campaign',
		'actions'
	] as const;

	export type TaskColumn = (typeof TASK_COLUMNS)[number];

	/**
	 * What the two task pages show — everything except `done`, the inline
	 * completion tick-box. Those pages complete work through the bulk bar and the
	 * sheet, and a list that both selects and completes with a checkbox each would
	 * be two tick-boxes a row apart meaning different things.
	 */
	export const DEFAULT_TASK_COLUMNS: readonly TaskColumn[] = TASK_COLUMNS.filter(
		(column) => column !== 'done'
	);

	/** The four fields that can be changed without opening the sheet. */
	export const EDITABLE_TASK_COLUMNS: readonly TaskColumn[] = [
		'label',
		'assignee',
		'dueOn',
		'priority'
	];
</script>

<script lang="ts">
	// The table, behind all three surfaces: the campaign list, the org-wide list
	// and a record's checklist.
	//
	// Rows arrive already filtered AND sorted by whoever queried them; nothing
	// here re-filters or re-sorts, because the server had to apply the leftover
	// filters anyway (the assignee one needs a db read) and two sorts that
	// disagree is a bug waiting for a tie. The checklist's order is its
	// template's, which is the same contract seen from the other side — so it
	// passes no `onSort` and gets plain headings.
	//
	// IT DOES WRITE. Ticking a row complete and the four in-place editors are
	// this component's own, not callbacks the three parents each implement: the
	// undo posture below only works if it is written once, and a table where the
	// same click means three slightly different things across three screens is
	// exactly what having one table is meant to prevent.

	// Primitives
	import { Badge, badgeVariants } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Checkbox } from '$lib/primitives/ui/checkbox';
	import { InlineEdit } from '$lib/primitives/ui/inline-edit';
	import { Input } from '$lib/primitives/ui/input';
	import * as Select from '$lib/primitives/ui/select';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import * as Table from '$lib/primitives/ui/table';
	import type { BadgeVariant } from '$lib/primitives/ui/badge';
	import { cn } from '$lib/primitives/utils';
	import { createListCollection } from '@ark-ui/svelte/select';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import PanelRightOpenIcon from '@lucide/svelte/icons/panel-right-open';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import { SvelteSet } from 'svelte/reactivity';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import { resolve } from '$app/paths';
	import { isOverdue } from './filters';
	import { TASK_PRIORITIES } from './types';
	import type { SortDir, TaskPriority, TaskSortKey, TaskStatus } from './types';
	import {
		ASSIGNEE_UNASSIGNED,
		assigneeOptionValue,
		parseAssigneeOption,
		type AssignableMembers,
		type TaskAssigneeWrite,
		type TaskRow
	} from './rows';
	import * as m from '$lib/i18n/messages';

	let {
		tasks,
		scope,
		today,
		columns = DEFAULT_TASK_COLUMNS,
		editable = [],
		members,
		sort,
		dir = 'asc',
		onSort,
		selected,
		onToggle,
		onToggleAll,
		onOpen,
		onDelete,
		canWrite,
		recordLabel = m.taskList_colProject(),
		showTaskDetail = false,
		publicTags,
		loading = false
	}: {
		tasks: TaskRow[];
		scope: 'campaign' | 'org';
		/**
		 * Which columns to render. Defaults to the full set, so a caller that does
		 * not care says nothing. A column named here still has to make sense —
		 * `campaign` is dropped outside org scope, where every row shares one.
		 */
		columns?: readonly TaskColumn[];
		/**
		 * Which of those columns edit IN PLACE. Same shape as `columns` on purpose:
		 * whether a surface offers inline editing is a configuration of the shared
		 * table, not a second table. Empty by default, so a caller opts in.
		 */
		editable?: readonly TaskColumn[];
		/** Required for an editable `assignee` column; loaded once by the page, not per row. */
		members?: AssignableMembers;
		/**
		 * The record column's heading. The campaign page passes that campaign's own
		 * word — "Family" at Jubilee — and only the org-wide page, which spans
		 * campaigns that each name it differently, falls back to the generic one.
		 */
		recordLabel?: string;
		/** ISO `YYYY-MM-DD` in the VIEWER's timezone — see TaskListView. */
		today: string;
		/** Absent means no column is the sort; headings then render as plain text. */
		sort?: TaskSortKey;
		dir?: SortDir;
		/** Omitted by a surface whose order is not the reader's to change. */
		onSort?: (key: TaskSortKey) => void;
		selected?: Set<string>;
		onToggle?: (taskId: string, checked: boolean) => void;
		onToggleAll?: (checked: boolean) => void;
		onOpen: (task: TaskRow) => void;
		onDelete?: (task: TaskRow) => void;
		/** Per campaign, because an org-wide list spans campaigns a team leader only partly holds. */
		canWrite: (campaignId: string) => boolean;
		/**
		 * Put the description and the impact tag under and beside the title. The
		 * list pages stay one line per row so their columns line up; a checklist is
		 * read down a single record and wants what each step actually says.
		 */
		showTaskDetail?: boolean;
		/** Tags whose stat is published. Only read when `showTaskDetail`. */
		publicTags?: ReadonlySet<string>;
		loading?: boolean;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

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

	const visibleColumns = $derived(
		// Filtered from TASK_COLUMNS rather than from `columns`, so the order is
		// the table's own no matter what order the caller listed them in.
		TASK_COLUMNS.filter(
			(column) => columns.includes(column) && (column !== 'campaign' || scope === 'org')
		)
	);

	// Only rows the viewer may write are selectable, so a bulk action can never
	// be assembled out of rows the server will refuse.
	const selectable = $derived(tasks.filter((task) => canWrite(task.campaignId)));
	const allSelected = $derived(
		selectable.length > 0 && selectable.every((task) => selected?.has(task._id))
	);
	const someSelected = $derived(selectable.some((task) => selected?.has(task._id)));

	function ariaSort(key: TaskSortKey): 'ascending' | 'descending' | 'none' {
		if (sort !== key) return 'none';
		return dir === 'asc' ? 'ascending' : 'descending';
	}

	// ------------------------------------------------------------------
	// Editing in place
	// ------------------------------------------------------------------

	/** One collection for the table rather than one per row. */
	const assigneeCollection = $derived(
		createListCollection({
			items: [
				{ value: ASSIGNEE_UNASSIGNED, label: m.taskList_unassigned() },
				...(members?.users ?? []).map((user) => ({
					value: assigneeOptionValue({ kind: 'user', userId: user.userId }),
					label: user.name
				})),
				// A contact linked to a member is the same person — listing both would
				// make which id gets stored depend on which row was clicked.
				...(members?.contacts ?? [])
					.filter((contact) => !contact.authUserId)
					.map((contact) => ({
						value: assigneeOptionValue({ kind: 'contact', contactId: contact.contactId }),
						label: contact.name
					}))
			]
		})
	);

	const priorityCollection = createListCollection({
		items: [...TASK_PRIORITIES]
			.reverse()
			.map((value) => ({ value, label: PRIORITY_LABEL[value]() }))
	});

	/** What `updateTask` accepts from this table. `null` clears; absent leaves alone. */
	type TaskPatch = {
		label?: string;
		assignee?: TaskAssigneeWrite | null;
		dueOn?: string | null;
		priority?: TaskPriority;
	};

	/** The rows with a write in flight, so each disables only itself. */
	const busy = new SvelteSet<string>();
	// Bumped on failure to REMOUNT the date input. Its DOM value is the user's
	// typing, and re-rendering the same `task.dueOn` would not touch it — the
	// rejected date would sit there looking saved.
	let failures = $state(0);

	function editableHas(column: TaskColumn): boolean {
		return editable.includes(column);
	}

	function message(error: unknown): string {
		if (error instanceof ConvexError) return String(error.data);
		return error instanceof Error ? error.message : m.state_saveFailed();
	}

	/**
	 * Every in-place change offers an UNDO on its toast, and every one of them
	 * does it the same way.
	 *
	 * A change made in the row can make the row leave — completing a task drops
	 * it out of a to-do list, reassigning it drops it out of "assigned to me" —
	 * and what you cannot see you cannot put back. Undo is on the toast rather
	 * than on a grace period that keeps the row visible for a few seconds,
	 * because a grace period makes the list disagree with the filter it says it
	 * is applying, and it loses the mis-click anyway the moment you navigate.
	 */
	async function apply(
		task: TaskRow,
		patch: TaskPatch,
		undo: TaskPatch,
		toastMessage: string
	): Promise<void> {
		// Per ROW, not one flag for the table: a second edit on another row while
		// the first is in flight is ordinary use, and a single flag would swallow
		// it silently — the worst possible failure for a control that looks saved.
		if (busy.has(task._id)) return;
		busy.add(task._id);
		try {
			await client.mutation(api.tasks.mutations.updateTask, { taskId: task._id, ...patch });
			toast.success(toastMessage, {
				action: {
					label: m.action_undo(),
					onClick: () => {
						void client
							.mutation(api.tasks.mutations.updateTask, { taskId: task._id, ...undo })
							.catch((error: unknown) => toast.error(message(error)));
					}
				}
			});
		} catch (error) {
			failures++;
			// Rethrown as a plain Error so InlineEdit — which catches, toasts and
			// puts the old text back — reports the server's own words rather than a
			// ConvexError's stringified wrapper.
			throw new Error(message(error), { cause: error });
		} finally {
			busy.delete(task._id);
		}
	}

	/** For the controls that cannot report their own failure. */
	function report(promise: Promise<void>): void {
		void promise.catch((error: unknown) => toast.error(message(error)));
	}

	async function setStatus(task: TaskRow, done: boolean): Promise<void> {
		if (busy.has(task._id)) return;
		busy.add(task._id);
		try {
			await client.mutation(api.tasks.mutations.setTaskStatus, {
				taskId: task._id,
				status: done ? 'done' : 'todo'
			});
			toast.success(
				done
					? m.taskList_completed({ label: task.label })
					: m.taskList_reopened({ label: task.label }),
				{
					action: {
						label: m.action_undo(),
						onClick: () => {
							void client
								.mutation(api.tasks.mutations.setTaskStatus, {
									taskId: task._id,
									status: done ? 'todo' : 'done'
								})
								.catch((error: unknown) => toast.error(message(error)));
						}
					}
				}
			);
		} catch (error) {
			toast.error(message(error));
		} finally {
			busy.delete(task._id);
		}
	}

	function editTitle(task: TaskRow, next: string): Promise<void> {
		return apply(
			task,
			{ label: next },
			{ label: task.label },
			m.taskList_edited({ label: next || task.label })
		);
	}

	function editAssignee(task: TaskRow, option: string): void {
		report(
			apply(
				task,
				{ assignee: parseAssigneeOption(option) },
				// `null` is how the mutation spells "unassigned", and an absent
				// assignee has to become one or undo would leave it alone.
				{ assignee: toAssigneeWrite(task) },
				m.taskList_edited({ label: task.label })
			)
		);
	}

	function editDueOn(task: TaskRow, next: string): void {
		report(
			apply(
				task,
				{ dueOn: next || null },
				{ dueOn: task.dueOn ?? null },
				m.taskList_edited({ label: task.label })
			)
		);
	}

	function editPriority(task: TaskRow, next: TaskPriority): void {
		report(
			apply(
				task,
				{ priority: next },
				{ priority: task.priority },
				m.taskList_edited({ label: task.label })
			)
		);
	}

	/** The row's current assignee in the shape the mutation takes back. */
	function toAssigneeWrite(task: TaskRow): TaskAssigneeWrite | null {
		if (!task.assignee) return null;
		return task.assignee.kind === 'user'
			? { kind: 'user', userId: task.assignee.userId }
			: { kind: 'contact', contactId: task.assignee.contactId };
	}
</script>

{#snippet head(key: TaskSortKey, label: string)}
	{#if onSort}
		<Table.Head aria-sort={ariaSort(key)}>
			<button
				type="button"
				class="hover:text-foreground -mx-1 flex items-center gap-1 rounded px-1 whitespace-nowrap"
				aria-label={m.taskList_sortBy({ column: label })}
				onclick={() => onSort?.(key)}
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
	{:else}
		<!-- A heading that cannot sort is TEXT, not a dead control. -->
		<Table.Head class="whitespace-nowrap">{label}</Table.Head>
	{/if}
{/snippet}

{#snippet headCell(column: TaskColumn)}
	{#if column === 'select'}
		<Table.Head class="w-1">
			<Checkbox
				checked={allSelected ? true : someSelected ? 'indeterminate' : false}
				disabled={selectable.length === 0}
				aria-label={m.taskList_selectAll()}
				onCheckedChange={(details) => onToggleAll?.(details.checked === true)}
			/>
		</Table.Head>
	{:else if column === 'done'}
		<!-- The tick-box column names itself for screen readers only: a heading
		     over a column of checkboxes states the obvious, in the narrowest cell
		     in the table. -->
		<Table.Head class="w-1"><span class="sr-only">{m.taskList_colStatus()}</span></Table.Head>
	{:else if column === 'label'}
		{@render head('label', m.taskList_colTask())}
	{:else if column === 'assignee'}
		{@render head('assignee', m.taskList_colAssignee())}
	{:else if column === 'dueOn'}
		{@render head('dueOn', m.taskList_colDue())}
	{:else if column === 'priority'}
		{@render head('priority', m.taskList_colPriority())}
	{:else if column === 'status'}
		{@render head('status', m.taskList_colStatus())}
	{:else if column === 'stage'}
		<Table.Head>{m.taskList_colStage()}</Table.Head>
	{:else if column === 'project'}
		{@render head('project', recordLabel)}
	{:else if column === 'campaign'}
		<Table.Head>{m.taskList_colCampaign()}</Table.Head>
	{:else if column === 'actions'}
		<Table.Head class="w-1 text-right">{m.field_actions()}</Table.Head>
	{/if}
{/snippet}

{#snippet templateIcon(task: TaskRow)}
	{#if task.source === 'template'}
		<ListChecksIcon
			class="text-muted-foreground size-3.5 shrink-0"
			aria-label={m.taskSheet_fromTemplate()}
		/>
	{/if}
{/snippet}

<!-- Beside the title in both the readable and the editable cell: the tag is what
     says this step feeds a number, and it must not depend on whether the row
     happens to be editable. -->
{#snippet titleBadges(task: TaskRow)}
	{#if showTaskDetail && task.impactTag}
		<Badge variant="secondary">{task.impactTag}</Badge>
		{#if publicTags?.has(task.impactTag)}
			<!-- The same badge a public custom field carries. -->
			<Badge variant="warning" class="gap-1">
				<EyeIcon class="size-3" aria-hidden="true" />
				{m.settings_fieldPublic()}
			</Badge>
		{/if}
	{/if}
{/snippet}

{#snippet titleText(task: TaskRow)}
	<span class="flex max-w-full items-center gap-2">
		{@render templateIcon(task)}
		<span
			class="truncate"
			class:line-through={task.status === 'done'}
			class:text-muted-foreground={task.status === 'done'}
		>
			{task.label}
		</span>
		{@render titleBadges(task)}
	</span>
{/snippet}

{#snippet bodyCell(column: TaskColumn, task: TaskRow, overdue: boolean, writable: boolean)}
	{#if column === 'select'}
		<Table.Cell>
			<Checkbox
				checked={selected?.has(task._id) ?? false}
				disabled={!writable}
				aria-label={m.taskList_selectRow({ label: task.label })}
				onCheckedChange={(details) => onToggle?.(task._id, details.checked === true)}
			/>
		</Table.Cell>
	{:else if column === 'done'}
		<Table.Cell>
			<Checkbox
				checked={task.status === 'done'}
				disabled={!writable || busy.has(task._id)}
				aria-label={m.tasks_toggleLabel({ label: task.label })}
				onCheckedChange={(details) => void setStatus(task, details.checked === true)}
			/>
		</Table.Cell>
	{:else if column === 'label'}
		<Table.Cell class="font-medium">
			<!-- The list caps the title so its columns keep their proportions across
			     hundreds of rows. A detailed row is being READ rather than scanned,
			     so it gets the width it needs. -->
			<div class="flex flex-col gap-1" class:max-w-xs={!showTaskDetail}>
				{#if editableHas('label')}
					<div class="flex items-center gap-1">
						<!-- With the title editable, opening the sheet needs a control of
						     its own — and an explicit one, reachable by keyboard, rather
						     than a click target hidden in the row. -->
						<button
							type="button"
							class="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring/50 flex size-6 shrink-0 items-center justify-center rounded focus-visible:ring-2 focus-visible:outline-none"
							aria-label={m.taskList_openRow({ label: task.label })}
							onclick={() => onOpen(task)}
						>
							<PanelRightOpenIcon class="size-3.5" aria-hidden="true" />
						</button>
						{@render templateIcon(task)}
						<!-- A template task's title is the checklist version's, and the
						     mutation refuses to change it — so the editor is disabled here
						     too. Offering an edit the server rejects is the worst of both. -->
						<InlineEdit
							class={cn(
								'min-w-0 flex-1',
								task.status === 'done' && 'text-muted-foreground line-through'
							)}
							inputClass="h-8"
							value={task.label}
							disabled={!writable || task.source === 'template'}
							ariaLabel={m.taskList_editTitle({ label: task.label })}
							onSave={(next) => editTitle(task, next)}
						/>
						{@render titleBadges(task)}
					</div>
				{:else}
					<button
						type="button"
						class="flex items-start text-left hover:underline"
						aria-label={m.taskList_openRow({ label: task.label })}
						onclick={() => onOpen(task)}
					>
						{@render titleText(task)}
					</button>
				{/if}
				{#if showTaskDetail && task.description}
					<span class="text-muted-foreground ps-1 text-xs font-normal text-wrap">
						{task.description}
					</span>
				{/if}
			</div>
		</Table.Cell>
	{:else if column === 'assignee'}
		<Table.Cell class="text-muted-foreground whitespace-nowrap">
			{#if editableHas('assignee') && writable}
				<Select.Root
					collection={assigneeCollection}
					value={[assigneeOptionValue(task.assignee)]}
					disabled={busy.has(task._id)}
					onValueChange={(details: { value: string[] }): void =>
						editAssignee(task, details.value[0] ?? ASSIGNEE_UNASSIGNED)}
				>
					<Select.Label class="sr-only">
						{m.taskList_editAssignee({ label: task.label })}
					</Select.Label>
					<!-- Borderless at rest: a column of framed selects reads as a form,
					     and this is a list first. -->
					<Select.Trigger
						size="sm"
						class="hover:bg-muted h-auto w-full border-0 bg-transparent px-1 py-0.5 shadow-none data-[size=sm]:h-auto dark:bg-transparent"
						placeholder={m.taskList_unassigned()}
					/>
					<Select.Content>
						{#each assigneeCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{:else}
				{task.assigneeName ?? m.taskList_unassigned()}
			{/if}
		</Table.Cell>
	{:else if column === 'dueOn'}
		<Table.Cell class="whitespace-nowrap tabular-nums">
			{#if editableHas('dueOn') && writable}
				<div class="flex items-center gap-2">
					{#key `${task.dueOn ?? ''}:${failures}`}
						<!-- Emptying the field clears the date — the mutation's `null`. -->
						<Input
							type="date"
							class={cn('h-8 w-36', overdue && 'text-destructive')}
							value={task.dueOn ?? ''}
							disabled={busy.has(task._id)}
							aria-label={m.taskList_editDue({ label: task.label })}
							onchange={(event: Event) =>
								editDueOn(task, (event.currentTarget as HTMLInputElement).value)}
						/>
					{/key}
					{#if overdue}
						<Badge variant="destructive">{m.taskList_overdue()}</Badge>
					{/if}
				</div>
			{:else if task.dueOn}
				<span class:text-destructive={overdue}>{task.dueOn}</span>
				{#if overdue}
					<Badge variant="destructive" class="ms-2">{m.taskList_overdue()}</Badge>
				{/if}
			{:else}
				<span class="text-muted-foreground">—</span>
			{/if}
		</Table.Cell>
	{:else if column === 'priority'}
		<Table.Cell>
			{#if editableHas('priority') && writable}
				<Select.Root
					collection={priorityCollection}
					value={[task.priority]}
					disabled={busy.has(task._id)}
					onValueChange={(details: { value: string[] }): void =>
						editPriority(task, (details.value[0] as TaskPriority) ?? task.priority)}
				>
					<Select.Label class="sr-only">
						{m.taskList_editPriority({ label: task.label })}
					</Select.Label>
					<!-- Wearing the badge it replaces, so urgency still reads at a glance
					     down the column instead of turning into a row of grey boxes. -->
					<Select.Trigger
						size="sm"
						class={cn(
							badgeVariants({ variant: PRIORITY_VARIANT[task.priority] }),
							'h-auto justify-between gap-1 px-2 py-0.5 data-[size=sm]:h-auto'
						)}
						placeholder={PRIORITY_LABEL[task.priority]()}
					/>
					<Select.Content>
						{#each priorityCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{:else}
				<Badge variant={PRIORITY_VARIANT[task.priority]}>{PRIORITY_LABEL[task.priority]()}</Badge>
			{/if}
		</Table.Cell>
	{:else if column === 'status'}
		<Table.Cell>
			<Badge variant={task.status === 'done' ? 'success' : 'outline'}>
				{STATUS_LABEL[task.status]()}
			</Badge>
		</Table.Cell>
	{:else if column === 'stage'}
		<Table.Cell class="text-muted-foreground">{task.stageLabel ?? '—'}</Table.Cell>
	{:else if column === 'project'}
		<Table.Cell class="text-muted-foreground whitespace-nowrap">
			{#if task.projectNumber}
				<!-- Straight to the record's CHECKLIST, not its overview: the question a
				     task row raises is "what else is on this record", and the tab lives
				     in the URL so the link can answer it in one click. The click is
				     stopped here so following it never also opens the sheet or selects
				     the row it sits in. -->
				<a
					class="hover:text-foreground hover:underline"
					href={resolve('/app/projects/[number]?tab=checklist', { number: task.projectNumber })}
					onclick={(event) => event.stopPropagation()}
				>
					{task.projectNumber}
				</a>
			{:else}
				<span class="text-xs">{m.taskList_campaignLevel()}</span>
			{/if}
		</Table.Cell>
	{:else if column === 'campaign'}
		<Table.Cell class="text-muted-foreground">{task.campaignName ?? '—'}</Table.Cell>
	{:else if column === 'actions'}
		<Table.Cell class="text-right whitespace-nowrap">
			{#if writable && onDelete}
				<Button
					size="icon"
					variant="ghost"
					aria-label={m.taskList_deleteTitle()}
					onclick={() => onDelete?.(task)}
				>
					<Trash2Icon />
				</Button>
			{/if}
		</Table.Cell>
	{/if}
{/snippet}

<!-- The TABLE scrolls sideways, never the page body: a narrow viewport should
     not push the nav off-screen to reach a due date. -->
<div class="overflow-x-auto rounded-lg border">
	<Table.Root>
		<Table.Header class="bg-muted">
			<Table.Row>
				{#each visibleColumns as column (column)}
					{@render headCell(column)}
				{/each}
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#if loading}
				<!-- Skeletons in the BODY only: the header and filter bar are already
				     correct, and replacing them would make the page jump. -->
				{#each [0, 1, 2, 3, 4] as row (row)}
					<Table.Row>
						<Table.Cell colspan={visibleColumns.length}>
							<Skeleton class="h-6 w-full" />
						</Table.Cell>
					</Table.Row>
				{/each}
			{:else}
				{#each tasks as task (task._id)}
					{@const overdue = isOverdue(task, today)}
					{@const writable = canWrite(task.campaignId)}
					<Table.Row data-state={selected?.has(task._id) ? 'selected' : undefined}>
						{#each visibleColumns as column (column)}
							{@render bodyCell(column, task, overdue, writable)}
						{/each}
					</Table.Row>
				{/each}
			{/if}
		</Table.Body>
	</Table.Root>
</div>
