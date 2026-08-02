<script lang="ts">
	// The filter bar renders IMMEDIATELY, before the list resolves, so the page
	// never jumps once rows arrive. It owns no state of its own: every control
	// reads `filters` and hands a whole new object back, because the single copy
	// of that state lives in the URL and TaskListView is what writes it.

	// Primitives
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import * as Select from '$lib/primitives/ui/select';
	import { createListCollection } from '@ark-ui/svelte/select';
	import XIcon from '@lucide/svelte/icons/x';

	import {
		DEFAULT_TASK_FILTERS,
		hasActiveTaskFilters,
		parseTaskQuery,
		serializeTaskFilters
	} from './filters';
	import { assigneeFilterOptions, withSelected } from './facets';
	import { TASK_PRIORITIES, type TaskFilters, type TaskPriority } from './types';
	import type { AssignableMembers, TaskFacets } from './rows';
	import * as m from '$lib/i18n/messages';

	let {
		filters,
		onChange,
		scope,
		stages = [],
		campaigns = [],
		projects = [],
		objectLabel,
		objectLabelPlural,
		members,
		facets
	}: {
		filters: TaskFilters;
		onChange: (next: TaskFilters) => void;
		scope: 'campaign' | 'org';
		/** Empty when no single campaign is in play — the stage filter hides itself. */
		stages?: { key: string; label: string }[];
		/** Org scope only; the campaign page already has one campaign. */
		campaigns?: { _id: string; name: string }[];
		/**
		 * Campaign scope only. A record belongs to exactly one campaign, so an
		 * org-wide record picker would be a list of things from everywhere that
		 * mostly cannot co-occur.
		 */
		projects?: { _id: string; number: string; name: string }[];
		/** What THIS campaign calls a record — "Family" at Jubilee, never "Project". */
		objectLabel: string;
		objectLabelPlural: string;
		members?: AssignableMembers;
		/**
		 * Which values actually have tasks behind them. The four lists above stay
		 * COMPLETE — they are what a value already chosen is named from, and the
		 * same lists feed controls that create and edit — while this is what the
		 * dropdowns are narrowed to. Undefined until the scan answers, and then
		 * nothing is narrowed; see `facets.ts`.
		 */
		facets?: TaskFacets;
	} = $props();

	const ANY = '';

	function patch(next: Partial<TaskFilters>): void {
		onChange({ ...filters, ...next });
	}

	// The assignee value is round-tripped through the pure module rather than
	// re-implementing its `user:` / `contact:` prefixes here. Two encoders for one
	// URL param is exactly the drift the module exists to prevent.
	const assigneeValue = $derived(
		filters.assignee
			? (new URLSearchParams(serializeTaskFilters(filters)).get('assignee') ?? ANY)
			: ANY
	);

	function setAssignee(value: string): void {
		const parsed = parseTaskQuery(new URLSearchParams(value ? { assignee: value } : {}));
		patch({ assignee: parsed.assignee });
	}

	const priorityLabels: Record<TaskPriority, () => string> = {
		low: m.taskPriority_low,
		normal: m.taskPriority_normal,
		high: m.taskPriority_high,
		urgent: m.taskPriority_urgent
	};

	// Only people with tasks — but the rules for that are in the pure module, not
	// here, because "what happens to the person you already picked" is the part
	// that is easy to get silently wrong.
	const assigneeCollection = $derived(
		createListCollection({
			items: assigneeFilterOptions(facets?.assignees, members, assigneeValue, {
				anyone: m.taskList_assigneeAnyone(),
				me: m.taskList_assigneeMe(),
				unassigned: m.taskList_assigneeUnassigned(),
				unknown: m.taskList_assigneeUnknown()
			})
		})
	);

	// Severity descending, so the filter people reach for most is at the top. The
	// stored order stays `TASK_PRIORITIES` — serialisation owns that, not the UI.
	const priorityCollection = createListCollection({
		items: [...TASK_PRIORITIES].reverse().map((priority) => ({
			value: priority,
			label: priorityLabels[priority]()
		}))
	});

	const statusCollection = createListCollection({
		items: [
			{ value: 'todo', label: m.taskStatus_todo() },
			{ value: 'done', label: m.taskStatus_done() },
			{ value: 'all', label: m.taskList_statusAll() }
		]
	});

	// A stage the campaign no longer defines can still have tasks on it, so the
	// facet carries its own label and is trusted over the campaign's list.
	const stageOptions = $derived(
		withSelected(facets?.stages, stages, (stage) => stage.key, filters.stageKey)
	);

	const stageCollection = $derived(
		createListCollection({
			items: [
				{ value: ANY, label: m.taskList_stageAny() },
				...stageOptions.map((stage) => ({ value: stage.key, label: stage.label }))
			]
		})
	);

	const campaignOptions = $derived(
		withSelected(facets?.campaigns, campaigns, (campaign) => campaign._id, filters.campaignId)
	);

	const campaignCollection = $derived(
		createListCollection({
			items: [
				{ value: ANY, label: m.taskList_campaignAny() },
				...campaignOptions.map((campaign) => ({ value: campaign._id, label: campaign.name }))
			]
		})
	);

	// Labelled `number — name`, the same way the sheet's record picker is: the
	// number is what the table column shows and what the sort orders on, so the
	// two surfaces name a record identically.
	const projectOptions = $derived(
		withSelected(facets?.projects, projects, (project) => project._id, filters.projectId)
	);

	const projectCollection = $derived(
		createListCollection({
			items: [
				{ value: ANY, label: m.taskList_projectAny({ label: objectLabelPlural }) },
				...projectOptions.map((project) => ({
					value: project._id,
					label: `${project.number} — ${project.name}`
				}))
			]
		})
	);

	const isFiltered = $derived(hasActiveTaskFilters(filters));

	// A control with nothing but "Anyone" in it is a dead control: it cannot
	// narrow anything and cannot be cleared, because nothing is set. All four
	// hide rather than sit there disabled — which is what the record and stage
	// pickers already did when their campaign had none, and the reading that
	// scales to a bar of six controls where a disabled one is just noise.
	const hasAssignees = $derived(assigneeCollection.items.length > 1);

	/** Sort survives a clear: it is a view preference, not a constraint. */
	function clear(): void {
		onChange({ ...DEFAULT_TASK_FILTERS, sort: filters.sort, dir: filters.dir });
	}
</script>

<div
	role="toolbar"
	aria-orientation="horizontal"
	class="flex w-full flex-wrap items-center gap-2 p-1"
>
	{#if hasAssignees}
		<Select.Root
			collection={assigneeCollection}
			ids={{ trigger: 'task-filter-assignee' }}
			value={[assigneeValue]}
			onValueChange={(details: { value: string[] }): void => setAssignee(details.value[0] ?? ANY)}
		>
			<Select.Label class="sr-only">{m.taskList_filterAssignee()}</Select.Label>
			<Select.Trigger size="sm" class="w-44" placeholder={m.taskList_assigneeAnyone()} />
			<Select.Content>
				{#each assigneeCollection.items as option (option.value)}
					<Select.Item item={option}>
						<Select.ItemText>{option.label}</Select.ItemText>
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/if}

	<Select.Root
		multiple
		collection={priorityCollection}
		ids={{ trigger: 'task-filter-priority' }}
		value={filters.priority}
		onValueChange={(details: { value: string[] }): void =>
			patch({ priority: TASK_PRIORITIES.filter((p) => details.value.includes(p)) })}
	>
		<Select.Label class="sr-only">{m.taskList_filterPriority()}</Select.Label>
		<Select.Trigger size="sm" class="w-40" placeholder={m.taskList_priorityAny()} />
		<Select.Content>
			{#each priorityCollection.items as option (option.value)}
				<Select.Item item={option}>
					<Select.ItemText>{option.label}</Select.ItemText>
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<Select.Root
		collection={statusCollection}
		ids={{ trigger: 'task-filter-status' }}
		value={[filters.status]}
		onValueChange={(details: { value: string[] }): void =>
			patch({ status: (details.value[0] as TaskFilters['status']) ?? 'todo' })}
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

	{#if scope === 'org' && campaignOptions.length > 0}
		<Select.Root
			collection={campaignCollection}
			ids={{ trigger: 'task-filter-campaign' }}
			value={[filters.campaignId ?? ANY]}
			onValueChange={(details: { value: string[] }): void =>
				patch({
					campaignId: details.value[0] || undefined,
					// A stage key and a record both belong to one campaign; carrying
					// either across would filter on something the new campaign has
					// never heard of, and the list would just be empty.
					stageKey: undefined,
					projectId: undefined
				})}
		>
			<Select.Label class="sr-only">{m.taskList_filterCampaign()}</Select.Label>
			<Select.Trigger size="sm" class="w-44" placeholder={m.taskList_campaignAny()} />
			<Select.Content>
				{#each campaignCollection.items as option (option.value)}
					<Select.Item item={option}>
						<Select.ItemText>{option.label}</Select.ItemText>
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/if}

	<!-- Records are per campaign too, and one that no task names has nothing to
	     offer — so the picker is absent rather than empty. Campaign scope only,
	     still: `objectLabel` is ONE campaign's word for a record, and the org-wide
	     page spans campaigns that each name it differently. -->
	{#if scope === 'campaign' && projectOptions.length > 0}
		<Select.Root
			collection={projectCollection}
			ids={{ trigger: 'task-filter-project' }}
			value={[filters.projectId ?? ANY]}
			onValueChange={(details: { value: string[] }): void =>
				patch({ projectId: details.value[0] || undefined })}
		>
			<!-- The campaign's own word, not "Record": Jubilee's users are looking
			     for a Family, and a generic label makes them translate. -->
			<Select.Label class="sr-only">{objectLabel}</Select.Label>
			<Select.Trigger
				size="sm"
				class="w-52"
				placeholder={m.taskList_projectAny({ label: objectLabelPlural })}
			/>
			<Select.Content>
				{#each projectCollection.items as option (option.value)}
					<Select.Item item={option}>
						<Select.ItemText>{option.label}</Select.ItemText>
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/if}

	<!-- Stages are per campaign, so this only makes sense once one is in play. -->
	{#if stageOptions.length > 0}
		<Select.Root
			collection={stageCollection}
			ids={{ trigger: 'task-filter-stage' }}
			value={[filters.stageKey ?? ANY]}
			onValueChange={(details: { value: string[] }): void =>
				patch({ stageKey: details.value[0] || undefined })}
		>
			<Select.Label class="sr-only">{m.taskList_filterStage()}</Select.Label>
			<Select.Trigger size="sm" class="w-40" placeholder={m.taskList_stageAny()} />
			<Select.Content>
				{#each stageCollection.items as option (option.value)}
					<Select.Item item={option}>
						<Select.ItemText>{option.label}</Select.ItemText>
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/if}

	<div class="flex items-center gap-1">
		<Label for="task-filter-due-after" class="text-muted-foreground text-xs">
			{m.taskList_dueAfter()}
		</Label>
		<Input
			id="task-filter-due-after"
			type="date"
			class="h-8 w-36"
			value={filters.dueAfter ?? ''}
			oninput={(event: Event & { currentTarget: HTMLInputElement }) =>
				patch({ dueAfter: event.currentTarget.value || undefined })}
		/>
	</div>

	<div class="flex items-center gap-1">
		<Label for="task-filter-due-before" class="text-muted-foreground text-xs">
			{m.taskList_dueBefore()}
		</Label>
		<Input
			id="task-filter-due-before"
			type="date"
			class="h-8 w-36"
			value={filters.dueBefore ?? ''}
			oninput={(event: Event & { currentTarget: HTMLInputElement }) =>
				patch({ dueBefore: event.currentTarget.value || undefined })}
		/>
	</div>

	{#if isFiltered}
		<Button size="sm" variant="ghost" onclick={clear}>
			<XIcon aria-hidden="true" />
			{m.taskList_clearFilters()}
		</Button>
	{/if}
</div>

<!-- Said out loud, exactly as the list says when its own page was cut: a
     shortlist that quietly stops short reads as a complete one. -->
{#if facets?.truncated}
	<p class="text-muted-foreground px-1 text-xs">{m.taskList_facetsTruncated()}</p>
{/if}
