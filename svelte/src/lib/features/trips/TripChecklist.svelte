<script lang="ts">
	// Travel readiness, which is a CHECKLIST and not a document store: §6 keeps
	// passport numbers, visa numbers and nationality out of the schema entirely,
	// because the app does not need the document — only the fact that somebody
	// checked it.
	//
	// Two kinds of row, and the split is the whole point. A trip item is answered
	// once ("book group lodging"); a per-attendee item is twelve rows, one per
	// traveller, because a single shared tick would hide the one person who
	// cannot board. Per-attendee items are `tasks` assigned
	// `{ kind: 'contact', contactId }`, so grouping by person is grouping by
	// assignee — no new mechanism.
	//
	// The sync action is `instantiateTripTasks`, which is ADDITIVE-ONLY: running
	// it twice, or after the template changes, only fills in what is missing. So
	// it is safe to offer whenever anything is pending.

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import * as Select from '$lib/primitives/ui/select';
	import { createListCollection } from '@ark-ui/svelte/select';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc } from '$convex/_generated/dataModel';

	import type { TaskRow } from '$lib/features/tasks/rows';
	import type { TaskStatus } from '$lib/features/tasks/types';
	import TaskSheet from '$lib/features/tasks/TaskSheet.svelte';
	import TaskTable, {
		EDITABLE_TASK_COLUMNS,
		type TaskColumn
	} from '$lib/features/tasks/TaskTable.svelte';
	import { resolve } from '$app/paths';
	import * as m from '$lib/i18n/messages';

	let { trip, canWrite }: { trip: Doc<'trips'>; canWrite: boolean } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	/** Trip items carry the assignee column; a person's own group is headed by their name. */
	const TRIP_COLUMNS: readonly TaskColumn[] = ['done', 'label', 'assignee', 'dueOn', 'priority'];
	const PERSON_COLUMNS: readonly TaskColumn[] = ['done', 'label', 'dueOn', 'priority'];

	// Today, from the CLIENT — local calendar parts rather than `toISOString()`,
	// which is UTC and would call tomorrow's work overdue west of Greenwich.
	const now = new Date();
	const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
		now.getDate()
	).padStart(2, '0')}`;

	const response = useQuery(api.tasks.queries.listTripChecklist, () => ({ tripId: trip._id }));

	const membersResponse = useQuery(api.tasks.queries.listAssignableMembers, () => ({
		campaignId: trip.campaignId
	}));
	const members = $derived(membersResponse.data);

	const allTasks = $derived<TaskRow[]>(response.data?.tasks ?? []);
	const pending = $derived(response.data?.pendingTemplateItems ?? 0);
	const hasTemplate = $derived(response.data?.hasActiveTemplate ?? false);

	let statusFilter = $state<TaskStatus | 'all'>('todo');

	const statusCollection = createListCollection({
		items: [
			{ value: 'todo', label: m.taskStatus_todo() },
			{ value: 'done', label: m.taskStatus_done() },
			{ value: 'all', label: m.taskList_statusAll() }
		]
	});

	const visible = $derived(
		statusFilter === 'all' ? allTasks : allTasks.filter((task) => task.status === statusFilter)
	);

	/** Everything that is not about one traveller. */
	const tripTasks = $derived(visible.filter((task) => task.assignee?.kind !== 'contact'));

	/**
	 * Per-attendee items, one group per person, in name order.
	 *
	 * A plain record rather than a Map, and deliberately: this is scratch working
	 * built fresh on every recompute, not reactive state, and `SvelteMap` exists
	 * for the case where the collection ITSELF is what changes.
	 */
	const personGroups = $derived.by(() => {
		const groups: Record<string, { name: string; tasks: TaskRow[] }> = {};
		for (const task of visible) {
			if (task.assignee?.kind !== 'contact') continue;
			const key = task.assignee.contactId as string;
			const group = groups[key];
			if (group) group.tasks.push(task);
			else groups[key] = { name: task.assigneeName ?? m.taskList_assigneeUnknown(), tasks: [task] };
		}
		return Object.entries(groups)
			.map(([contactId, group]) => ({ contactId, ...group }))
			.sort((a, b) => a.name.localeCompare(b.name));
	});

	// Counted over EVERY task, not the visible ones: the progress line is what
	// stops a filtered checklist from reading as an emptier one.
	const doneCount = $derived(allTasks.filter((task) => task.status === 'done').length);

	let sheetOpen = $state(false);
	let sheetTask = $state<TaskRow | null>(null);
	let isSyncing = $state(false);

	async function sync(): Promise<void> {
		if (isSyncing || !canWrite) return;
		isSyncing = true;
		try {
			const created = await client.mutation(api.tasks.mutations.syncTripTasks, {
				tripId: trip._id
			});
			toast.success(m.tasks_added({ count: created }));
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSyncing = false;
		}
	}

	function openEdit(task: TaskRow): void {
		sheetTask = task;
		sheetOpen = true;
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.tripDetail_checklist()}</Card.Title>
		<Card.Description>
			{#if allTasks.length > 0}
				{m.tasks_progress({ done: doneCount, total: allTasks.length })}
			{:else}
				{m.tripDetail_checklistBody()}
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
			{#if canWrite && pending > 0}
				<Button variant="outline" size="sm" loading={isSyncing} onclick={sync}>
					{m.tasks_addFromTemplate({ count: pending })}
				</Button>
			{/if}
		</Card.Action>
	</Card.Header>
	<Card.Content class="flex flex-col gap-6">
		{#if !response.isLoading && allTasks.length === 0}
			<EmptyState
				size="sm"
				variant="plain"
				title={hasTemplate ? m.tasks_emptyTitle() : m.tripDetail_noTemplateTitle()}
				description={hasTemplate
					? m.tripDetail_checklistEmptyBody()
					: m.tripDetail_noTemplateBody()}
			>
				{#snippet icon()}
					<ListChecksIcon />
				{/snippet}
				{#snippet action()}
					<!--
						Authoring lives in campaign settings, where every other template
						does. Linking out rather than editing inline keeps one place to
						change a campaign-level object — editing it from inside one trip
						is how every future trip gets changed by accident.
					-->
					{#if !hasTemplate && canWrite}
						<Button variant="outline" size="sm" href={resolve('/app/settings')}>
							{m.tripDetail_editTripChecklist()}
						</Button>
					{/if}
				{/snippet}
			</EmptyState>
		{:else if !response.isLoading && visible.length === 0}
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
			{#if tripTasks.length > 0}
				<section class="flex flex-col gap-2">
					<h3 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
						{m.tripDetail_checklistTripItems()}
					</h3>
					<!-- No `onSort`: the order is the campaign's trip template's. -->
					<TaskTable
						tasks={tripTasks}
						{today}
						{members}
						scope="campaign"
						columns={TRIP_COLUMNS}
						editable={EDITABLE_TASK_COLUMNS}
						showTaskDetail
						loading={response.isLoading}
						onOpen={openEdit}
						canWrite={() => canWrite}
					/>
				</section>
			{/if}

			{#each personGroups as group (group.contactId)}
				<section class="flex flex-col gap-2">
					<h3 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
						{group.name}
					</h3>
					<TaskTable
						tasks={group.tasks}
						{today}
						{members}
						scope="campaign"
						columns={PERSON_COLUMNS}
						editable={EDITABLE_TASK_COLUMNS}
						showTaskDetail
						loading={response.isLoading}
						onOpen={openEdit}
						canWrite={() => canWrite}
					/>
				</section>
			{/each}
		{/if}
	</Card.Content>
</Card.Root>

<!-- Keyed on the task, so switching rows REMOUNTS the sheet: its fields are
     `$state` seeded on mount, and without the key one row's unsaved text would
     appear under the next row's title. Existing rows only — a task created from
     scratch here would carry no tripId and would vanish from this list. -->
{#key sheetTask?._id ?? 'none'}
	<TaskSheet
		bind:open={sheetOpen}
		task={sheetTask}
		campaignId={trip.campaignId}
		{members}
		{canWrite}
	/>
{/key}
