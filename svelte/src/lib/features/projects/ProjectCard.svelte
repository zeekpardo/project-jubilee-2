<script lang="ts">
	import { resolve } from '$app/paths';
	import ImageIcon from '@lucide/svelte/icons/image';
	import * as Card from '$lib/primitives/ui/card';
	import type { Doc } from '$convex/_generated/dataModel';
	import type { PipelineStage } from '$lib/domain/stages';
	import * as m from '$lib/i18n/messages';
	import StageBadge from './StageBadge.svelte';
	import ProjectProgress from './ProjectProgress.svelte';
	import { useProjectMoney } from './money.svelte';

	let { project, stages }: { project: Doc<'projects'>; stages: PipelineStage[] } = $props();

	const money = useProjectMoney(() => project._id);
</script>

<Card.Root class="overflow-hidden pt-0">
	<div class="bg-muted relative aspect-video w-full">
		{#if project.photoUrl}
			<img
				src={project.photoUrl}
				alt={m.projects_photo()}
				class="h-full w-full object-cover"
				loading="lazy"
			/>
		{:else}
			<div class="text-muted-foreground flex h-full w-full items-center justify-center">
				<ImageIcon class="size-8" aria-hidden="true" />
			</div>
		{/if}
		<div class="absolute top-2 left-2">
			<StageBadge stage={project.stage} {stages} />
		</div>
	</div>
	<Card.Header>
		<Card.Title class="text-base">
			<a
				class="hover:underline"
				href={resolve('/app/projects/[number]', { number: project.number })}
			>
				{project.name}
			</a>
		</Card.Title>
		<Card.Description class="font-mono text-xs">{project.number}</Card.Description>
	</Card.Header>
	<Card.Content>
		<ProjectProgress raisedCents={money.raisedCents} targetCents={money.targetCents} showAmounts />
	</Card.Content>
</Card.Root>
