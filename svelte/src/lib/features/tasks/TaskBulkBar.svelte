<script lang="ts">
	// Appears only with a selection, and holds exactly the four actions the spec
	// names. Each control ACTS on change rather than staging an edit — there is
	// no Save here, so a half-set bar cannot be left behind when the selection
	// clears underneath it.

	// Primitives
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import * as Select from '$lib/primitives/ui/select';
	import { createListCollection } from '@ark-ui/svelte/select';
	import CheckIcon from '@lucide/svelte/icons/check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import XIcon from '@lucide/svelte/icons/x';

	import { TASK_PRIORITIES, type TaskPriority } from './types';
	import {
		ASSIGNEE_UNASSIGNED,
		assigneeOptionValue,
		parseAssigneeOption,
		type AssignableMembers,
		type TaskAssigneeWrite,
		type TaskImpactWarning
	} from './rows';
	import * as m from '$lib/i18n/messages';

	let {
		count,
		max,
		members,
		warnings = [],
		busy = false,
		onAssign,
		onDue,
		onPriority,
		onComplete,
		onClear
	}: {
		count: number;
		max: number;
		members?: AssignableMembers;
		/** Selected tasks whose stat is published; empty means nothing to warn about. */
		warnings?: TaskImpactWarning[];
		busy?: boolean;
		/** `null` clears the assignee — the mutation's own convention. */
		onAssign: (assignee: TaskAssigneeWrite | null) => void;
		onDue: (dueOn: string | null) => void;
		onPriority: (priority: TaskPriority) => void;
		onComplete: () => void;
		onClear: () => void;
	} = $props();

	const overLimit = $derived(count > max);
	const disabled = $derived(busy || overLimit);

	const assigneeCollection = $derived(
		createListCollection({
			items: [
				{ value: ASSIGNEE_UNASSIGNED, label: m.taskList_unassigned() },
				...(members?.users ?? []).map((user) => ({
					value: assigneeOptionValue({ kind: 'user', userId: user.userId }),
					label: user.name
				})),
				// A contact already linked to a member is the same person; offering
				// them twice makes the picker a coin flip about which id gets stored.
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
		items: [...TASK_PRIORITIES].reverse().map((priority) => ({
			value: priority,
			label: {
				low: m.taskPriority_low,
				normal: m.taskPriority_normal,
				high: m.taskPriority_high,
				urgent: m.taskPriority_urgent
			}[priority]()
		}))
	});

	function assign(value: string): void {
		if (!value) return;
		onAssign(parseAssigneeOption(value));
	}

	/** The distinct public numbers the selection would move, for the warning line. */
	const statNames = $derived([...new Set(warnings.map((warning) => warning.statLabel))].join(', '));
</script>

<div
	role="region"
	aria-label={m.taskList_bulkSelected({ count })}
	class="bg-muted/60 flex flex-wrap items-center gap-2 rounded-lg border p-2"
>
	<span class="px-1 text-sm font-medium">{m.taskList_bulkSelected({ count })}</span>

	<Select.Root
		collection={assigneeCollection}
		ids={{ trigger: 'task-bulk-assignee' }}
		value={[]}
		{disabled}
		onValueChange={(details: { value: string[] }): void => assign(details.value[0] ?? '')}
	>
		<Select.Label class="sr-only">{m.taskList_bulkAssign()}</Select.Label>
		<Select.Trigger size="sm" class="w-44" placeholder={m.taskList_bulkAssign()} />
		<Select.Content>
			{#each assigneeCollection.items as option (option.value)}
				<Select.Item item={option}>
					<Select.ItemText>{option.label}</Select.ItemText>
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<Input
		type="date"
		class="h-8 w-36"
		{disabled}
		aria-label={m.taskList_bulkDue()}
		value=""
		onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
			onDue(event.currentTarget.value || null)}
	/>

	<Select.Root
		collection={priorityCollection}
		ids={{ trigger: 'task-bulk-priority' }}
		value={[]}
		{disabled}
		onValueChange={(details: { value: string[] }): void => {
			const next = details.value[0] as TaskPriority | undefined;
			if (next) onPriority(next);
		}}
	>
		<Select.Label class="sr-only">{m.taskList_bulkPriority()}</Select.Label>
		<Select.Trigger size="sm" class="w-36" placeholder={m.taskList_bulkPriority()} />
		<Select.Content>
			{#each priorityCollection.items as option (option.value)}
				<Select.Item item={option}>
					<Select.ItemText>{option.label}</Select.ItemText>
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<Button size="sm" variant="outline" {disabled} loading={busy} onclick={onComplete}>
		<CheckIcon aria-hidden="true" />
		{m.taskList_bulkComplete()}
	</Button>

	<Button size="sm" variant="ghost" class="ms-auto" onclick={onClear}>
		<XIcon aria-hidden="true" />
		{m.taskList_bulkClear()}
	</Button>

	{#if overLimit}
		<p class="text-destructive w-full px-1 text-xs">{m.taskList_bulkTooMany({ max })}</p>
	{:else if warnings.length > 0}
		<!-- Said BEFORE the click, not after: one bulk complete can move a figure
		     that is currently on the donor page. -->
		<p class="text-warning-700-300 flex w-full items-center gap-2 px-1 text-xs">
			<TriangleAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
			{m.taskList_bulkCompleteBody({ count: warnings.length, stats: statNames })}
		</p>
	{/if}
</div>
