<script lang="ts">
	import { createListCollection } from '@ark-ui/svelte/select';
	import type { SwitchCheckedChangeDetails } from '$lib/primitives/ui/switch';
	import { toast } from 'svelte-sonner';
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Switch } from '$lib/primitives/ui/switch';
	import * as Select from '$lib/primitives/ui/select';
	import type { Doc } from '$convex/_generated/dataModel';
	import type { PipelineStage } from '$lib/domain/stages';
	import * as m from '$lib/i18n/messages';
	import StageBadge from './StageBadge.svelte';

	let {
		project,
		stages,
		goalLabel,
		canWrite
	}: {
		project: Doc<'projects'>;
		stages: PipelineStage[];
		goalLabel: string;
		canWrite: boolean;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const stageCollection = $derived(
		createListCollection({
			items: stages.map((stage) => ({ value: stage.key, label: stage.label }))
		})
	);

	function fail(error: unknown): void {
		toast.error(error instanceof Error ? error.message : m.state_error());
	}

	async function changeStage(next: string | undefined): Promise<void> {
		if (!next || next === project.stage) return;
		try {
			await client.mutation(api.projects.mutations.setProjectStage, {
				projectId: project._id,
				stage: next
			});
		} catch (error: unknown) {
			fail(error);
		}
	}

	async function changePublished(isPublished: boolean): Promise<void> {
		try {
			await client.mutation(api.projects.mutations.setProjectPublished, {
				projectId: project._id,
				isPublished
			});
		} catch (error: unknown) {
			fail(error);
		}
	}

	async function changeGoalMet(isGoalMet: boolean): Promise<void> {
		try {
			await client.mutation(api.projects.mutations.setProjectGoalMet, {
				projectId: project._id,
				isGoalMet
			});
		} catch (error: unknown) {
			fail(error);
		}
	}
</script>

<div class="flex flex-wrap items-start justify-between gap-4">
	<div class="min-w-0">
		<div class="flex items-center gap-3">
			<h1 class="truncate text-2xl font-bold tracking-tight lg:text-3xl">{project.name}</h1>
			<StageBadge stage={project.stage} {stages} />
		</div>
		<p class="text-muted-foreground mt-1 font-mono text-sm">{project.number}</p>
	</div>

	{#if canWrite}
		<div class="flex flex-wrap items-center gap-4">
			<Select.Root
				collection={stageCollection}
				value={[project.stage]}
				onValueChange={(details: { value: string[] }): void => {
					void changeStage(details.value[0]);
				}}
			>
				<Select.Label class="sr-only">{m.projects_stage()}</Select.Label>
				<Select.Trigger size="sm" class="w-44" placeholder={m.projects_stage()} />
				<Select.Content>
					{#each stageCollection.items as option (option.value)}
						<Select.Item item={option}>
							<Select.ItemText>{option.label}</Select.ItemText>
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>

			<Switch
				checked={project.isPublished}
				onCheckedChange={(details: SwitchCheckedChangeDetails): void => {
					void changePublished(details.checked);
				}}
			>
				{m.projects_published()}
			</Switch>

			<Switch
				checked={project.isGoalMet}
				onCheckedChange={(details: SwitchCheckedChangeDetails): void => {
					void changeGoalMet(details.checked);
				}}
			>
				{goalLabel}
			</Switch>
		</div>
	{:else}
		<div class="flex flex-wrap items-center gap-2">
			{#if project.isPublished}
				<Badge variant="success">{m.projects_published()}</Badge>
			{/if}
			{#if project.isGoalMet}
				<Badge variant="success">{goalLabel}</Badge>
			{/if}
		</div>
	{/if}
</div>
