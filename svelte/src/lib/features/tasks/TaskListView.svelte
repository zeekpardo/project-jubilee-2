<script lang="ts">
	// ============================================================
	// The one task list, behind both pages
	// ============================================================
	// The campaign page and the admin page differ by `scope` and one extra
	// column. Building them separately is the refactor this component exists to
	// avoid, so everything that is not literally "which campaign" lives here.
	//
	// FILTERS LIVE IN THE URL. There is no filter store: `page.url.searchParams`
	// is the state, `parseTaskQuery` reads it and `serializeTaskFilters` writes
	// it. A filtered list is therefore a link, and the navigation is
	// replaceState + keepFocus + noScroll so changing a filter neither stacks
	// history entries nor throws the caret out of the control being used.
	//
	// NOTHING IS RE-FILTERED HERE. `listTasks` returns rows already filtered,
	// sorted and hydrated — it has to, because "assigned to me" needs the
	// user↔contact link and only the server can resolve it. A second client-side
	// pass could only disagree.
	// ============================================================

	// Primitives
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';
	import { SvelteSet } from 'svelte/reactivity';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import {
		DEFAULT_TASK_FILTERS,
		hasActiveTaskFilters,
		parseTaskQuery,
		serializeTaskFilters
	} from './filters';
	import type { TaskFilters, TaskPriority, TaskSortKey } from './types';
	import type { TaskAssigneeWrite, TaskRow } from './rows';
	import TaskBulkBar from './TaskBulkBar.svelte';
	import TaskFilterBar from './TaskFilterBar.svelte';
	import TaskSavedViews from './TaskSavedViews.svelte';
	import TaskSheet from './TaskSheet.svelte';
	import TaskTable, { EDITABLE_TASK_COLUMNS } from './TaskTable.svelte';
	import * as m from '$lib/i18n/messages';

	let {
		scope,
		campaignId = null
	}: {
		scope: 'campaign' | 'org';
		/**
		 * The campaign to list. Required in campaign scope and ignored in org
		 * scope, where the campaign is a FILTER and lives in the URL like the
		 * rest of them. Read from `ActiveCampaignContext` by the page — this
		 * component never writes that context.
		 */
		campaignId?: Id<'campaigns'> | null;
	} = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();
	const access = getAccessContext();
	// READ-ONLY, for the campaign's own word for a record. Nothing here writes
	// the context: filtering must not change which campaign is active.
	const active = getActiveCampaignContext();

	/** How many rows one bulk call may touch — mirrors `BULK_TASK_MAX` server-side. */
	const BULK_MAX = 200;

	// ------------------------------------------------------------------
	// Today, from the client
	// ------------------------------------------------------------------
	// Local calendar parts, not `toISOString()`: that returns UTC, and west of
	// Greenwich after 5pm it would call tomorrow's tasks overdue. The server is
	// never asked — a Convex query that read the clock would go stale with no
	// write and poison its own cache for every other viewer.
	const now = new Date();
	const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
		now.getDate()
	).padStart(2, '0')}`;

	// ------------------------------------------------------------------
	// URL state
	// ------------------------------------------------------------------

	const filters = $derived(parseTaskQuery(page.url.searchParams));
	const isFiltered = $derived(hasActiveTaskFilters(filters));

	/**
	 * Put a query string in the address bar. The one place this component
	 * navigates — a saved view is applied through here too, by handing over its
	 * stored string, because a view IS a URL and re-deriving it from parsed
	 * filters would be a second copy of the state the URL already holds.
	 */
	function applyQuery(query: string): void {
		// Written as the full pathname through `resolve`, the way every other
		// navigation in this app is, rather than a bare `?query` — the lint rule
		// that enforces it is what keeps typed routes honest. The query is dropped
		// entirely when nothing is set, so an unfiltered list has a clean address
		// rather than a dangling '?'.
		const target = `${page.url.pathname}${query ? `?${query.replace(/^\?/, '')}` : ''}` as Pathname;
		void goto(resolve(target), {
			replaceState: true,
			// Typing in a filter must not push a history entry, move focus out of
			// the control being used, or jump the page back to the top.
			keepFocus: true,
			noScroll: true
		});
	}

	function applyFilters(next: TaskFilters): void {
		applyQuery(serializeTaskFilters(next));
	}

	/** Clicking the active column flips direction; a new column starts ascending. */
	function sortBy(key: TaskSortKey): void {
		applyFilters({
			...filters,
			sort: key,
			dir: filters.sort === key && filters.dir === 'asc' ? 'desc' : 'asc'
		});
	}

	// ------------------------------------------------------------------
	// Data
	// ------------------------------------------------------------------

	const allowed = $derived(
		scope === 'campaign' ? access.can('projects:read', campaignId) : access.can('projects:read')
	);

	const campaignsResponse = useQuery(api.campaigns.queries.listCampaigns, () =>
		auth.isAuthenticated && scope === 'org' ? {} : 'skip'
	);
	const campaigns = $derived(campaignsResponse.data ?? []);

	// The campaign filter is checked against the campaigns actually on offer
	// before it reaches the query. `listTasks` types it as `v.id('campaigns')`,
	// so a hand-edited `?campaign=nonsense` would fail argument validation with a
	// stack trace — where the parser's whole posture is that a broken filter
	// falls back to the default list.
	const filterCampaignId = $derived(
		scope === 'org'
			? ((campaigns.find((campaign) => campaign._id === filters.campaignId)?._id ??
					null) as Id<'campaigns'> | null)
			: null
	);

	/** The single campaign in play, if there is one: the scope's, or the filter's. */
	const activeCampaignId = $derived(scope === 'campaign' ? campaignId : filterCampaignId);

	const listResponse = useQuery(api.tasks.queries.listTasks, () =>
		auth.isAuthenticated && allowed
			? {
					scope,
					campaignId: (scope === 'campaign' ? campaignId : filterCampaignId) ?? undefined,
					assignee: filters.assignee,
					priority: filters.priority.length > 0 ? filters.priority : undefined,
					status: filters.status,
					stageKey: filters.stageKey,
					projectId: filters.projectId,
					dueAfter: filters.dueAfter,
					dueBefore: filters.dueBefore,
					sort: filters.sort,
					dir: filters.dir
				}
			: 'skip'
	);
	const tasks = $derived(listResponse.data?.tasks ?? []);
	const truncated = $derived(listResponse.data?.truncated ?? false);
	const loading = $derived(listResponse.isLoading);

	// EVERYONE, for the sheet's picker and the bulk bar: you cannot assign a task
	// to someone the list left out. The FILTER's shorter list is `facets` below —
	// the two must not be collapsed into one query.
	const membersResponse = useQuery(api.tasks.queries.listAssignableMembers, () =>
		auth.isAuthenticated && allowed ? { campaignId: activeCampaignId ?? undefined } : 'skip'
	);
	const members = $derived(membersResponse.data);

	// Which values the filters can actually offer. A SEPARATE read from the list:
	// `listTasks` caps at its page size, so deriving the dropdowns from the rows
	// on screen would hide every value that only exists past the cap.
	//
	// Only `status` is passed alongside the scope. The rest of the filters are
	// deliberately withheld — facets computed over the filtered set would delete
	// every other option the moment one was picked, and there would be no way to
	// switch from one person to another. Status is the exception because it
	// defaults to hiding completed work, so it is the one filter that can leave a
	// live-looking option with nothing behind it.
	const facetsResponse = useQuery(api.tasks.queries.listTaskFacets, () =>
		auth.isAuthenticated && allowed
			? {
					scope,
					campaignId: (scope === 'campaign' ? campaignId : filterCampaignId) ?? undefined,
					status: filters.status
				}
			: 'skip'
	);
	const facets = $derived(facetsResponse.data);

	// Stages belong to one campaign, so the filter is only offered once one is in
	// play. Across campaigns the same label can mean different keys.
	const stagesResponse = useQuery(api.pipelineStages.queries.listStages, () =>
		auth.isAuthenticated && activeCampaignId ? { campaignId: activeCampaignId } : 'skip'
	);
	const stages = $derived(stagesResponse.data ?? []);

	// The record picker is CAMPAIGN SCOPE ONLY. A record belongs to exactly one
	// campaign, so an org-wide list of them would mostly be options that cannot
	// co-occur with whatever else is filtered.
	const projectsResponse = useQuery(api.projects.queries.listProjects, () =>
		auth.isAuthenticated && allowed && scope === 'campaign' && campaignId ? { campaignId } : 'skip'
	);
	const projects = $derived(projectsResponse.data ?? []);

	// Both surfaces edit in place. The org-wide page is where someone triages
	// across campaigns — reassigning a batch, pushing dates — and sending them
	// through the sheet one row at a time to change a single field is the slower
	// path, not the safer one. Every guard the fields carry is per-row and
	// travels with them: a template title stays read-only, a viewer without
	// write access gets plain text, and a failed write reverts and says why.

	// What THIS campaign calls a record — "Family" at Jubilee. The org-wide page
	// spans campaigns that each name it differently, so it keeps the generic word
	// rather than borrowing one campaign's.
	const recordLabel = $derived(scope === 'campaign' ? active.objectLabel : m.taskList_colProject());

	// ------------------------------------------------------------------
	// Selection
	// ------------------------------------------------------------------

	const selected = new SvelteSet<string>();

	// A row that filtering removed is no longer selectable, and keeping its id
	// would let a bulk action reach a task the user can no longer see.
	$effect(() => {
		const visible = new Set(tasks.map((task) => task._id as string));
		for (const id of selected) {
			if (!visible.has(id)) selected.delete(id);
		}
	});

	function canWriteCampaign(id: string): boolean {
		return access.can('projects:write', id);
	}

	function toggle(taskId: string, checked: boolean): void {
		if (checked) selected.add(taskId);
		else selected.delete(taskId);
	}

	function toggleAll(checked: boolean): void {
		selected.clear();
		if (!checked) return;
		for (const task of tasks) {
			if (canWriteCampaign(task.campaignId)) selected.add(task._id);
		}
	}

	const selectedIds = $derived([...selected] as Id<'tasks'>[]);

	// ------------------------------------------------------------------
	// Naming the consequence
	// ------------------------------------------------------------------
	// Asked BEFORE the click, for both the bulk bar and the delete confirm: a
	// completed tagged task sits behind a number on the donor page, and one
	// click either way moves it.

	const bulkWarningsResponse = useQuery(api.tasks.queries.listTaskImpactWarnings, () =>
		auth.isAuthenticated && selectedIds.length > 0
			? { taskIds: selectedIds.slice(0, BULK_MAX) }
			: 'skip'
	);
	// Only rows still to do can be raised by "mark complete"; the done ones are
	// already counted and would make the warning read as news when it is not.
	const bulkWarnings = $derived(
		(bulkWarningsResponse.data ?? []).filter((warning) => warning.status === 'todo')
	);

	let deleting = $state<TaskRow | null>(null);
	let deleteOpen = $state(false);

	const deleteWarningsResponse = useQuery(api.tasks.queries.listTaskImpactWarnings, () =>
		auth.isAuthenticated && deleting ? { taskIds: [deleting._id] } : 'skip'
	);
	// A task only reduces a published figure if it is COMPLETE: an unticked one
	// has never counted, so removing it changes nothing public.
	const deleteWarning = $derived(
		(deleteWarningsResponse.data ?? []).find((warning) => warning.status === 'done') ?? null
	);

	// ------------------------------------------------------------------
	// The sheet
	// ------------------------------------------------------------------

	let sheetOpen = $state(false);
	let sheetTask = $state<TaskRow | null>(null);

	/**
	 * A new task needs a campaign to belong to. In org scope that is whatever the
	 * campaign filter names, so with no filter there is nothing to create into —
	 * the button is withheld and the empty state says which choice is missing,
	 * rather than offering a form that cannot be submitted.
	 */
	const newCampaignId = $derived(activeCampaignId);
	const canCreate = $derived(newCampaignId !== null && canWriteCampaign(newCampaignId));

	// The campaign the sheet writes into: the task's own when editing, because an
	// org-wide list spans campaigns and the filter is not necessarily the row's.
	const sheetCampaignId = $derived(
		(sheetTask?.campaignId as Id<'campaigns'> | undefined) ?? newCampaignId
	);

	function openCreate(): void {
		sheetTask = null;
		sheetOpen = true;
	}

	function openEdit(task: TaskRow): void {
		sheetTask = task;
		sheetOpen = true;
	}

	function openDelete(task: TaskRow): void {
		deleting = task;
		deleteOpen = true;
	}

	// ------------------------------------------------------------------
	// Writes
	// ------------------------------------------------------------------

	let isBulking = $state(false);

	function reportError(error: unknown): void {
		toast.error(
			error instanceof ConvexError
				? String(error.data)
				: error instanceof Error
					? error.message
					: m.state_saveFailed()
		);
	}

	async function bulk(patch: {
		assignee?: TaskAssigneeWrite | null;
		dueOn?: string | null;
		priority?: TaskPriority;
		status?: 'todo' | 'done';
	}): Promise<void> {
		if (isBulking || selectedIds.length === 0) return;
		isBulking = true;
		try {
			const count = await client.mutation(api.tasks.mutations.bulkUpdateTasks, {
				taskIds: selectedIds,
				...patch
			});
			toast.success(m.taskList_bulkDone({ count }));
			// The rows are still there and still correct; keeping them selected
			// would invite a second, unintended application of the next control.
			selected.clear();
		} catch (error) {
			reportError(error);
		} finally {
			isBulking = false;
		}
	}

	async function confirmDelete(): Promise<void> {
		if (!deleting) return;
		await client.mutation(api.tasks.mutations.deleteTask, { taskId: deleting._id });
		selected.delete(deleting._id);
		toast.success(m.taskList_deleted());
	}

	const deleteBody = $derived(
		deleting
			? deleteWarning
				? m.taskList_deletePublicBody({ label: deleting.label, stat: deleteWarning.statLabel })
				: m.taskList_deleteBody({ label: deleting.label })
			: ''
	);
</script>

<div class="flex flex-col gap-4">
	<TaskSavedViews {filters} onApply={applyQuery} />

	<!-- The bar renders before the rows resolve, so the page does not jump. -->
	<TaskFilterBar
		{filters}
		{scope}
		{members}
		{facets}
		onChange={applyFilters}
		objectLabel={active.objectLabel}
		objectLabelPlural={active.objectLabelPlural}
		stages={stages.map((stage) => ({ key: stage.key, label: stage.label }))}
		campaigns={campaigns.map((campaign) => ({ _id: campaign._id, name: campaign.name }))}
		projects={projects.map((project) => ({
			_id: project._id,
			number: project.number,
			name: project.name
		}))}
	/>

	{#if canCreate}
		<div>
			<Button size="sm" onclick={openCreate}>
				<PlusIcon aria-hidden="true" />
				{m.taskList_new()}
			</Button>
		</div>
	{/if}

	{#if selected.size > 0}
		<TaskBulkBar
			count={selected.size}
			max={BULK_MAX}
			{members}
			warnings={bulkWarnings}
			busy={isBulking}
			onAssign={(assignee) => void bulk({ assignee })}
			onDue={(dueOn) => void bulk({ dueOn })}
			onPriority={(priority) => void bulk({ priority })}
			onComplete={() => void bulk({ status: 'done' })}
			onClear={() => selected.clear()}
		/>
	{/if}

	{#if !loading && tasks.length === 0}
		<!-- TWO empty states, and deliberately different copy: a filtered page that
		     says "no tasks yet" reads as a broken one. -->
		{#if isFiltered}
			<EmptyState title={m.taskList_noMatchTitle()} description={m.taskList_noMatchBody()}>
				{#snippet icon()}
					<ListChecksIcon />
				{/snippet}
				{#snippet action()}
					<!-- Sort survives a clear: it is a view preference, not a constraint,
					     and re-sorting an empty list brings nothing back anyway. -->
					<Button
						variant="outline"
						onclick={() =>
							applyFilters({ ...DEFAULT_TASK_FILTERS, sort: filters.sort, dir: filters.dir })}
					>
						{m.taskList_clearFilters()}
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<EmptyState title={m.taskList_emptyTitle()} description={m.taskList_emptyBody()}>
				{#snippet icon()}
					<ListChecksIcon />
				{/snippet}
				{#snippet action()}
					{#if canCreate}
						<Button onclick={openCreate}>
							<PlusIcon aria-hidden="true" />
							{m.taskList_new()}
						</Button>
					{:else if scope === 'org'}
						<span class="text-muted-foreground text-sm">{m.taskList_pickCampaignToAdd()}</span>
					{/if}
				{/snippet}
			</EmptyState>
		{/if}
	{:else}
		<TaskTable
			{tasks}
			{scope}
			{today}
			{loading}
			{selected}
			{members}
			{recordLabel}
			editable={EDITABLE_TASK_COLUMNS}
			sort={filters.sort}
			dir={filters.dir}
			onSort={sortBy}
			onToggle={toggle}
			onToggleAll={toggleAll}
			onOpen={openEdit}
			onDelete={openDelete}
			canWrite={canWriteCampaign}
		/>
	{/if}

	{#if truncated}
		<!-- Said out loud: a silently truncated list reads as missing data. -->
		<p class="text-muted-foreground px-1 text-xs">
			{m.taskList_truncated({ count: tasks.length })}
		</p>
	{/if}
</div>

<!-- Keyed on the task, so switching rows REMOUNTS the sheet. The form's fields
     are `$state` seeded from props, and seeding only runs on mount — without
     the key the previous row's unsaved text would appear under the next row's
     title. -->
{#if sheetCampaignId}
	{#key sheetTask?._id ?? 'new'}
		<TaskSheet
			bind:open={sheetOpen}
			task={sheetTask}
			campaignId={sheetCampaignId}
			{members}
			canWrite={canWriteCampaign(sheetCampaignId)}
		/>
	{/key}
{/if}

<ConfirmDialog
	bind:open={deleteOpen}
	title={m.taskList_deleteTitle()}
	body={deleteBody}
	onConfirm={confirmDelete}
/>
