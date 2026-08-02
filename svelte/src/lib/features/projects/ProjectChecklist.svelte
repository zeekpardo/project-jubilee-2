<script lang="ts">
	// A record's checklist — the same table the task pages use, with the columns
	// that mean something on this screen.
	//
	// What makes it a CHECKLIST rather than a third task list is what it leaves
	// out: no filters beyond status, no sort (the order is the campaign
	// template's), no Record or Campaign column — you are standing on the record
	// — and a tick-box as the first column, because completing a step is what
	// people come here to do.
	//
	// COMPLETED ITEMS ARE HIDDEN, matching the task pages, whose default filter is
	// `todo`. The filtering happens HERE rather than in the query, for two
	// reasons: a checklist is tens of rows, so the whole set is already in hand;
	// and `pendingTemplateItems` has to be counted against every task whatever its
	// status, or the sync button would offer to re-add steps that exist and are
	// done — which would create duplicates.

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import * as Select from '$lib/primitives/ui/select';
	import { createListCollection } from '@ark-ui/svelte/select';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc } from '$convex/_generated/dataModel';

	import { getAccessContext } from '$lib/access';
	import type { TaskRow } from '$lib/features/tasks/rows';
	import type { TaskStatus } from '$lib/features/tasks/types';
	import TaskSheet from '$lib/features/tasks/TaskSheet.svelte';
	import TaskTable, {
		EDITABLE_TASK_COLUMNS,
		type TaskColumn
	} from '$lib/features/tasks/TaskTable.svelte';
	import * as m from '$lib/i18n/messages';

	let { project }: { project: Doc<'projects'> } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();
	const access = getAccessContext();

	const canWrite = $derived(access.can('projects:write', project.campaignId));

	/** Neither Record nor Campaign: both would repeat one value down every row. */
	const COLUMNS: readonly TaskColumn[] = ['done', 'label', 'assignee', 'dueOn', 'priority'];

	// Today, from the CLIENT — local calendar parts rather than `toISOString()`,
	// which is UTC and would call tomorrow's work overdue west of Greenwich. The
	// server is never asked: a Convex query that read the clock would go stale
	// with no write and poison its own cache.
	const now = new Date();
	const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
		now.getDate()
	).padStart(2, '0')}`;

	const response = useQuery(api.tasks.queries.listProjectChecklist, () => ({
		projectId: project._id
	}));

	// Which tags are actually published, read live from the campaign's stat
	// config rather than off the task. Ticking an item that feeds a public
	// number is worth knowing at the moment you tick it.
	const tagsResponse = useQuery(api.taskTemplates.queries.listImpactTags, () => ({
		campaignId: project.campaignId
	}));
	const publicTags = $derived(
		new Set(
			(tagsResponse.data ?? []).filter((entry) => entry.showOnPublic).map((entry) => entry.tag)
		)
	);

	// For the assignee column and the sheet's picker, both of which are on this
	// screen from the start now that a row edits in place.
	const membersResponse = useQuery(api.tasks.queries.listAssignableMembers, () => ({
		campaignId: project.campaignId
	}));
	const members = $derived(membersResponse.data);

	const allTasks = $derived(response.data?.tasks ?? []);
	const pending = $derived(response.data?.pendingTemplateItems ?? 0);
	const hasTemplate = $derived(response.data?.hasActiveTemplate ?? false);

	// The same three-way choice the task pages offer, in the same words and with
	// the same default. Held in component state rather than the URL: the record
	// page's query string is its open TAB, and a checklist's status is a glance,
	// not a view someone links to.
	let statusFilter = $state<TaskStatus | 'all'>('todo');

	const statusCollection = createListCollection({
		items: [
			{ value: 'todo', label: m.taskStatus_todo() },
			{ value: 'done', label: m.taskStatus_done() },
			{ value: 'all', label: m.taskList_statusAll() }
		]
	});

	const tasks = $derived(
		statusFilter === 'all' ? allTasks : allTasks.filter((task) => task.status === statusFilter)
	);

	// Counted over EVERY task, not the visible ones: the progress line is what
	// stops a filtered checklist from reading as an emptier one.
	const doneCount = $derived(allTasks.filter((task) => task.status === 'done').length);

	let sheetOpen = $state(false);
	let sheetTask = $state<TaskRow | null>(null);

	let isSyncing = $state(false);

	function reportError(error: unknown): void {
		toast.error(
			error instanceof ConvexError
				? String(error.data)
				: error instanceof Error
					? error.message
					: m.state_saveFailed()
		);
	}

	async function sync(): Promise<void> {
		if (isSyncing || !canWrite) return;
		isSyncing = true;
		try {
			const created = await client.mutation(api.tasks.mutations.syncProjectTasks, {
				projectId: project._id
			});
			toast.success(m.tasks_added({ count: created }));
		} catch (error) {
			reportError(error);
		} finally {
			isSyncing = false;
		}
	}

	function openCreate(): void {
		sheetTask = null;
		sheetOpen = true;
	}

	function openEdit(task: TaskRow): void {
		sheetTask = task;
		sheetOpen = true;
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.tasks_title()}</Card.Title>
		<Card.Description>
			{#if allTasks.length > 0}
				{m.tasks_progress({ done: doneCount, total: allTasks.length })}
			{:else}
				{m.tasks_body()}
			{/if}
		</Card.Description>
		<Card.Action class="flex flex-wrap items-center gap-2">
			<Select.Root
				collection={statusCollection}
				value={[statusFilter]}
				onValueChange={(details: { value: string[] }): void => {
					statusFilter = (details.value[0] as TaskStatus | 'all') ?? 'todo';
				}}
			>
				<Select.Label class="sr-only">{m.taskList_filterStatus()}</Select.Label>
				<Select.Trigger size="sm" class="w-32" placeholder={m.taskStatus_todo()} />
				<Select.Content>
					{#each statusCollection.items as option (option.value)}
						<Select.Item item={option}>
							<Select.ItemText>{option.label}</Select.ItemText>
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			{#if canWrite}
				<!-- New task is offered even when the campaign defines no checklist at
				     all: whether a template exists is the campaign's business, and this
				     record still has work that belongs to it. -->
				{#if pending > 0}
					<Button variant="outline" size="sm" loading={isSyncing} onclick={sync}>
						{m.tasks_addFromTemplate({ count: pending })}
					</Button>
				{/if}
				<Button size="sm" onclick={openCreate}>
					<PlusIcon aria-hidden="true" />
					{m.taskList_new()}
				</Button>
			{/if}
		</Card.Action>
	</Card.Header>
	<Card.Content>
		{#if !response.isLoading && allTasks.length === 0}
			<EmptyState
				size="sm"
				variant="plain"
				title={hasTemplate ? m.tasks_emptyTitle() : m.tasks_noTemplateTitle()}
				description={hasTemplate ? m.tasks_emptyBody() : m.tasks_noTemplateBody()}
			>
				{#snippet icon()}
					<ListChecksIcon />
				{/snippet}
			</EmptyState>
		{:else if !response.isLoading && tasks.length === 0}
			<!-- Distinct copy from "no checklist yet", and it carries the count: a
			     record whose steps are all done must not read as a record with none. -->
			<EmptyState
				size="sm"
				variant="plain"
				title={m.tasks_filteredEmptyTitle()}
				description={m.tasks_filteredEmptyBody({ done: doneCount, total: allTasks.length })}
			>
				{#snippet icon()}
					<ListChecksIcon />
				{/snippet}
			</EmptyState>
		{:else}
			<!-- No `onSort`: the order is the template's, and a heading that reordered
			     a checklist would be answering a question nobody asked here. -->
			<TaskTable
				{tasks}
				{today}
				{members}
				{publicTags}
				scope="campaign"
				columns={COLUMNS}
				editable={EDITABLE_TASK_COLUMNS}
				showTaskDetail
				loading={response.isLoading}
				onOpen={openEdit}
				canWrite={() => canWrite}
			/>
		{/if}
	</Card.Content>
</Card.Root>

<!-- Keyed on the task, so switching rows REMOUNTS the sheet: its fields are
     `$state` seeded on mount, and without the key one row's unsaved text would
     appear under the next row's title. The record is PINNED — on this screen it
     is not a choice. -->
{#key sheetTask?._id ?? 'new'}
	<TaskSheet
		bind:open={sheetOpen}
		task={sheetTask}
		campaignId={project.campaignId}
		presetProjectId={project._id}
		{members}
		{canWrite}
	/>
{/key}
