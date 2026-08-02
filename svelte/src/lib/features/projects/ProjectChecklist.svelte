<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Checkbox } from '$lib/primitives/ui/checkbox';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc } from '$convex/_generated/dataModel';

	import { getAccessContext } from '$lib/access';
	import * as m from '$lib/i18n/messages';

	let { project }: { project: Doc<'projects'> } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();
	const access = getAccessContext();

	const canWrite = $derived(access.can('projects:write', project.campaignId));

	const response = useQuery(api.tasks.queries.listTasks, () => ({ projectId: project._id }));

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
	const tasks = $derived(response.data?.tasks ?? []);
	const pending = $derived(response.data?.pendingTemplateItems ?? 0);
	const hasTemplate = $derived(response.data?.hasActiveTemplate ?? false);

	let busyId = $state<string | null>(null);
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

	async function toggle(task: Doc<'tasks'>, checked: boolean): Promise<void> {
		if (busyId || !canWrite) return;
		busyId = task._id;
		try {
			await client.mutation(api.tasks.mutations.setTaskStatus, {
				taskId: task._id,
				status: checked ? 'done' : 'todo'
			});
		} catch (error) {
			reportError(error);
		} finally {
			busyId = null;
		}
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

	const doneCount = $derived(tasks.filter((task) => task.status === 'done').length);
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.tasks_title()}</Card.Title>
		<Card.Description>
			{#if tasks.length > 0}
				{m.tasks_progress({ done: doneCount, total: tasks.length })}
			{:else}
				{m.tasks_body()}
			{/if}
		</Card.Description>
		{#if canWrite && pending > 0}
			<Card.Action>
				<Button variant="outline" size="sm" loading={isSyncing} onclick={sync}>
					{m.tasks_addFromTemplate({ count: pending })}
				</Button>
			</Card.Action>
		{/if}
	</Card.Header>
	<Card.Content>
		{#if response.isLoading}
			<div class="flex flex-col gap-3">
				<Skeleton class="h-6 w-full" />
				<Skeleton class="h-6 w-full" />
				<Skeleton class="h-6 w-full" />
			</div>
		{:else if tasks.length === 0}
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
		{:else}
			<ul class="flex flex-col">
				{#each tasks as task (task._id)}
					<li class="flex flex-col gap-1 border-b py-3 last:border-b-0">
						<Checkbox
							class="items-start"
							labelClass="flex flex-wrap items-center gap-2"
							checked={task.status === 'done'}
							disabled={!canWrite || busyId === task._id}
							onCheckedChange={(details) => void toggle(task, details.checked === true)}
						>
							<span
								class:line-through={task.status === 'done'}
								class:text-muted-foreground={task.status === 'done'}
							>
								{task.label}
							</span>
							{#if task.impactTag}
								<Badge variant="secondary">{task.impactTag}</Badge>
							{/if}
							{#if task.impactTag && publicTags.has(task.impactTag)}
								<!-- The same badge a public custom field carries. -->
								<Badge variant="warning" class="gap-1">
									<EyeIcon class="size-3" aria-hidden="true" />
									{m.settings_fieldPublic()}
								</Badge>
							{/if}
						</Checkbox>
						{#if task.note}
							<p class="text-muted-foreground ps-7 text-xs">{task.note}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</Card.Content>
</Card.Root>
