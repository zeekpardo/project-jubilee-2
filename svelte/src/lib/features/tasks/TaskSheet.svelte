<script lang="ts">
	// Create and edit, in one side sheet.
	//
	// MOUNTED UNDER `{#key}` by TaskListView, one instance per task. The form's
	// values are `$state` seeded from the props, and seeding only happens on
	// mount — which is precisely why the key is there. Resetting by hand instead
	// would mean remembering to reset every field the next person adds, and the
	// failure mode is the previous row's unsaved text appearing under the next
	// row's title.

	// Primitives
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import * as Drawer from '$lib/primitives/ui/drawer';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import * as Select from '$lib/primitives/ui/select';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { createListCollection } from '@ark-ui/svelte/select';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import XIcon from '@lucide/svelte/icons/x';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import { TASK_PRIORITIES, type TaskPriority } from './types';
	import {
		ASSIGNEE_UNASSIGNED,
		assigneeOptionValue,
		parseAssigneeOption,
		type AssignableMembers,
		type TaskRow
	} from './rows';
	import * as m from '$lib/i18n/messages';

	let {
		open = $bindable(false),
		task,
		campaignId,
		members,
		canWrite,
		presetProjectId = null
	}: {
		open?: boolean;
		/** Null creates. The component is keyed on this, so it never changes in place. */
		task: TaskRow | null;
		campaignId: Id<'campaigns'>;
		members?: AssignableMembers;
		canWrite: boolean;
		/**
		 * PINS the record. Set by a surface that already is one — the record's own
		 * checklist — where the record is not a choice: a new task belongs to it,
		 * and moving an existing one elsewhere would make the row vanish from the
		 * list it was opened from. The task pages leave this unset and get the
		 * record picker.
		 */
		presetProjectId?: Id<'projects'> | null;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	// A template task snapshotted its title, key and impact tag from the checklist
	// item it was created against. Editing them per record would make two records
	// disagree about what the same step means, so they render read-only — and the
	// mutation refuses them anyway, because a disabled input is not a rule.
	const fromTemplate = $derived(task?.source === 'template');

	const NONE = '';

	// The values this sheet opened with, read ONCE. `untrack` states the intent
	// the key already guarantees: a different task is a different instance, so
	// these props never change under a mounted sheet and reading them
	// non-reactively is the design rather than an oversight.
	const initial = untrack(() => ({
		label: task?.label ?? '',
		description: task?.description ?? '',
		assigneeOption: assigneeOptionValue(task?.assignee),
		dueOn: task?.dueOn ?? '',
		priority: task?.priority ?? ('normal' as TaskPriority),
		projectId:
			(task?.projectId as string | undefined) ?? (presetProjectId as string | null) ?? NONE,
		stageKey: task?.stageKey ?? NONE,
		impactTag: task?.impactTag ?? NONE
	}));

	let label = $state(initial.label);
	let description = $state(initial.description);
	let assigneeOption = $state(initial.assigneeOption);
	let dueOn = $state(initial.dueOn);
	let priority = $state<TaskPriority>(initial.priority);
	let projectId = $state<string>(initial.projectId);
	let stageKey = $state(initial.stageKey);
	let impactTag = $state(initial.impactTag);

	let isSaving = $state(false);
	let discardOpen = $state(false);

	// Dirty is a COMPARISON against that snapshot, not a flag every handler has
	// to remember to set.
	const isDirty = $derived(
		label !== initial.label ||
			description !== initial.description ||
			assigneeOption !== initial.assigneeOption ||
			dueOn !== initial.dueOn ||
			priority !== initial.priority ||
			projectId !== initial.projectId ||
			stageKey !== initial.stageKey ||
			impactTag !== initial.impactTag
	);

	const stagesResponse = useQuery(api.pipelineStages.queries.listStages, () =>
		open ? { campaignId } : 'skip'
	);
	const projectsResponse = useQuery(api.projects.queries.listProjects, () =>
		open ? { campaignId } : 'skip'
	);
	const tagsResponse = useQuery(api.taskTemplates.queries.listImpactTags, () =>
		open ? { campaignId } : 'skip'
	);

	const publicTags = $derived(
		new Set((tagsResponse.data ?? []).filter((entry) => entry.showOnPublic).map((e) => e.tag))
	);

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
		items: [...TASK_PRIORITIES].reverse().map((value) => ({
			value,
			label: {
				low: m.taskPriority_low,
				normal: m.taskPriority_normal,
				high: m.taskPriority_high,
				urgent: m.taskPriority_urgent
			}[value]()
		}))
	});

	const projectCollection = $derived(
		createListCollection({
			items: [
				{ value: NONE, label: m.taskSheet_projectNone() },
				...(projectsResponse.data ?? []).map((project) => ({
					value: project._id as string,
					label: `${project.number} — ${project.name}`
				}))
			]
		})
	);

	const stageCollection = $derived(
		createListCollection({
			items: [
				{ value: NONE, label: m.taskSheet_stageNone() },
				...(stagesResponse.data ?? []).map((stage) => ({ value: stage.key, label: stage.label }))
			]
		})
	);

	const tagCollection = $derived(
		createListCollection({
			items: [
				{ value: NONE, label: m.taskSheet_impactTagNone() },
				...(tagsResponse.data ?? []).map((entry) => ({ value: entry.tag, label: entry.tag }))
			]
		})
	);

	// The pinned record still renders — it decides whether the impact tag is
	// offered, and a form that hides which record it is writing to is a form you
	// cannot check before saving.
	const pinnedProject = $derived(presetProjectId !== null);
	const pinnedProjectLabel = $derived(
		projectCollection.items.find((option) => option.value === projectId)?.label ?? ''
	);

	// Impact stats count DISTINCT projects, so a tagged campaign-level task would
	// count zero forever and look broken. The write refuses it; here the control
	// is disabled with the reason next to it rather than failing on save.
	const tagAllowed = $derived(projectId !== NONE);

	const canSubmit = $derived(canWrite && label.trim().length > 0 && !isSaving);

	function reportError(error: unknown): void {
		toast.error(
			error instanceof ConvexError
				? String(error.data)
				: error instanceof Error
					? error.message
					: m.state_saveFailed()
		);
	}

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!canSubmit) return;
		isSaving = true;
		try {
			const assignee = parseAssigneeOption(assigneeOption);
			if (task) {
				await client.mutation(api.tasks.mutations.updateTask, {
					taskId: task._id,
					// `null` clears, an absent key leaves alone — the mutation's own
					// convention, because Convex cannot tell omitted from undefined.
					description: description.trim() || null,
					assignee,
					dueOn: dueOn || null,
					priority,
					stageKey: stageKey || null,
					projectId: (projectId as Id<'projects'>) || null,
					// The snapshotted columns are not sent for a template task at all.
					// Sending them unchanged would be accepted, but omitting them keeps
					// the read-only rendering and the request telling the same story.
					...(fromTemplate ? {} : { label: label.trim(), impactTag: impactTag || null })
				});
				toast.success(m.taskSheet_saved());
			} else {
				await client.mutation(api.tasks.mutations.createTask, {
					campaignId,
					label: label.trim(),
					description: description.trim() || undefined,
					assignee: assignee ?? undefined,
					dueOn: dueOn || undefined,
					priority,
					projectId: (projectId as Id<'projects'>) || undefined,
					stageKey: stageKey || undefined,
					impactTag: impactTag || undefined
				});
				toast.success(m.taskSheet_created());
			}
			open = false;
		} catch (error) {
			reportError(error);
		} finally {
			isSaving = false;
		}
	}

	/**
	 * Closing a dirty sheet asks first. NAVIGATING away does not — SvelteKit
	 * navigation is not blocked here, and the spec's call is that a lost draft
	 * beats a trapped user.
	 */
	function requestClose(): void {
		if (isDirty) {
			discardOpen = true;
			return;
		}
		open = false;
	}
</script>

<!-- Escape and click-outside are DISABLED while the form is dirty rather than
     intercepted: the underlying dialog writes its own close back through the
     binding before a handler can veto it, so the only way to make the confirm
     mean anything is for the accidental dismissals not to happen. Cancel and
     the X are still one click away, and both ask. -->
<Drawer.Root bind:open closeOnInteractOutside={!isDirty} closeOnEscape={!isDirty}>
	<Drawer.Content side="right" class="sm:max-w-md">
		<Drawer.Header class="pe-10">
			<Drawer.Title>{task ? m.taskSheet_editTitle() : m.taskSheet_newTitle()}</Drawer.Title>
			{#if fromTemplate}
				<Drawer.Description class="flex flex-wrap items-center gap-2">
					<Badge variant="secondary" class="gap-1">
						<ListChecksIcon class="size-3" aria-hidden="true" />
						{m.taskSheet_fromTemplate()}
					</Badge>
				</Drawer.Description>
			{/if}
		</Drawer.Header>

		<Button
			type="button"
			variant="ghost"
			size="icon"
			class="absolute top-4 right-4"
			aria-label={m.action_close()}
			onclick={requestClose}
		>
			<XIcon />
		</Button>

		<!-- The body scrolls on its own so the title and the Save button stay put. -->
		<form id="task-sheet-form" class="flex-1 overflow-y-auto" onsubmit={save}>
			<div class="flex flex-col gap-4 pe-1">
				<div class="flex flex-col gap-2">
					<Label for="task-label">{m.taskSheet_title()}</Label>
					<Input
						id="task-label"
						bind:value={label}
						required
						readonly={fromTemplate}
						disabled={!canWrite}
						placeholder={m.taskSheet_titlePlaceholder()}
					/>
					{#if fromTemplate}
						<p class="text-muted-foreground text-xs">{m.taskSheet_templateReadonly()}</p>
					{/if}
				</div>

				{#if fromTemplate && task?.key}
					<div class="flex flex-col gap-2">
						<Label for="task-key">{m.taskSheet_key()}</Label>
						<Input id="task-key" value={task.key} readonly />
					</div>
				{/if}

				<div class="flex flex-col gap-2">
					<Label for="task-description">{m.taskSheet_description()}</Label>
					<Textarea id="task-description" bind:value={description} disabled={!canWrite} rows={3} />
				</div>

				<div class="flex flex-col gap-2">
					<Label for="task-assignee">{m.taskSheet_assignee()}</Label>
					<Select.Root
						collection={assigneeCollection}
						ids={{ trigger: 'task-assignee' }}
						value={[assigneeOption]}
						disabled={!canWrite}
						onValueChange={(details: { value: string[] }): void => {
							assigneeOption = details.value[0] ?? ASSIGNEE_UNASSIGNED;
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.taskList_unassigned()} />
						<Select.Content>
							{#each assigneeCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="flex flex-col gap-2">
					<Label for="task-due">{m.taskSheet_dueOn()}</Label>
					<!-- A date input, because `dueOn` is a calendar day: a timestamp would
					     make "due today" depend on who is reading it. -->
					<Input id="task-due" type="date" bind:value={dueOn} disabled={!canWrite} />
				</div>

				<div class="flex flex-col gap-2">
					<Label for="task-priority">{m.taskSheet_priority()}</Label>
					<Select.Root
						collection={priorityCollection}
						ids={{ trigger: 'task-priority' }}
						value={[priority]}
						disabled={!canWrite}
						onValueChange={(details: { value: string[] }): void => {
							priority = (details.value[0] as TaskPriority) ?? 'normal';
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.taskPriority_normal()} />
						<Select.Content>
							{#each priorityCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="flex flex-col gap-2">
					<Label for="task-project">{m.taskSheet_project()}</Label>
					{#if pinnedProject}
						<Input id="task-project" value={pinnedProjectLabel} readonly />
						<p class="text-muted-foreground text-xs">{m.taskSheet_projectPinned()}</p>
					{:else}
						<Select.Root
							collection={projectCollection}
							ids={{ trigger: 'task-project' }}
							value={[projectId]}
							disabled={!canWrite}
							onValueChange={(details: { value: string[] }): void => {
								projectId = details.value[0] ?? NONE;
								// Dropping the record drops the tag with it, so the form cannot
								// hold a combination the write would refuse.
								if (projectId === NONE) impactTag = NONE;
							}}
						>
							<Select.Trigger class="w-full" placeholder={m.taskSheet_projectNone()} />
							<Select.Content>
								{#each projectCollection.items as option (option.value)}
									<Select.Item item={option}>
										<Select.ItemText>{option.label}</Select.ItemText>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					{/if}
				</div>

				<div class="flex flex-col gap-2">
					<Label for="task-stage">{m.taskSheet_stage()}</Label>
					<Select.Root
						collection={stageCollection}
						ids={{ trigger: 'task-stage' }}
						value={[stageKey]}
						disabled={!canWrite}
						onValueChange={(details: { value: string[] }): void => {
							stageKey = details.value[0] ?? NONE;
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.taskSheet_stageNone()} />
						<Select.Content>
							{#each stageCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="flex flex-col gap-2">
					<Label for="task-tag">{m.taskSheet_impactTag()}</Label>
					{#if fromTemplate}
						<Input id="task-tag" value={impactTag || '—'} readonly />
					{:else}
						<Select.Root
							collection={tagCollection}
							ids={{ trigger: 'task-tag' }}
							value={[impactTag]}
							disabled={!canWrite || !tagAllowed}
							onValueChange={(details: { value: string[] }): void => {
								impactTag = details.value[0] ?? NONE;
							}}
						>
							<Select.Trigger class="w-full" placeholder={m.taskSheet_impactTagNone()} />
							<Select.Content>
								{#each tagCollection.items as option (option.value)}
									<Select.Item item={option}>
										<Select.ItemText>{option.label}</Select.ItemText>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					{/if}
					{#if !tagAllowed}
						<p class="text-muted-foreground text-xs">{m.taskSheet_impactTagNeedsProject()}</p>
					{:else if impactTag && publicTags.has(impactTag)}
						<p class="text-warning-700-300 flex items-center gap-2 text-xs">
							<EyeIcon class="size-3.5 shrink-0" aria-hidden="true" />
							{m.taskSheet_impactTagPublic()}
						</p>
					{/if}
				</div>
			</div>
		</form>

		<Drawer.Footer class="flex-row justify-end">
			<Button type="button" variant="outline" onclick={requestClose} disabled={isSaving}>
				{m.action_cancel()}
			</Button>
			{#if canWrite}
				<Button type="submit" form="task-sheet-form" loading={isSaving} disabled={!canSubmit}>
					{task ? m.action_saveChanges() : m.action_create()}
				</Button>
			{/if}
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>

<ConfirmDialog
	bind:open={discardOpen}
	title={m.taskSheet_discardTitle()}
	body={m.taskSheet_discardBody()}
	confirmLabel={m.taskSheet_discardConfirm()}
	onConfirm={async () => {
		open = false;
	}}
/>
