<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';
	import type { Doc } from '$convex/_generated/dataModel';
	import type { PipelineStage } from '$lib/domain/stages';
	import * as m from '$lib/i18n/messages';
	import StageBadge from './StageBadge.svelte';
	import ProjectProgress from './ProjectProgress.svelte';
	import { formatCents, progressPercent } from './format';
	import { useProjectMoney } from './money.svelte';

	let { project, stages }: { project: Doc<'projects'>; stages: PipelineStage[] } = $props();

	const money = useProjectMoney(() => project._id);
	const percent = $derived(progressPercent(money.raisedCents, money.targetCents));
</script>

<Table.Row>
	<Table.Cell class="font-mono text-xs whitespace-nowrap">{project.number}</Table.Cell>
	<Table.Cell class="font-medium">
		<a class="hover:underline" href={resolve('/app/projects/[number]', { number: project.number })}>
			{project.name}
		</a>
	</Table.Cell>
	<Table.Cell><StageBadge stage={project.stage} {stages} /></Table.Cell>
	<Table.Cell class="text-right tabular-nums">{formatCents(money.targetCents)}</Table.Cell>
	<Table.Cell class="text-right tabular-nums">{formatCents(money.raisedCents)}</Table.Cell>
	<Table.Cell class="w-40">
		<div class="flex items-center gap-2">
			<ProjectProgress
				class="min-w-16 flex-1"
				raisedCents={money.raisedCents}
				targetCents={money.targetCents}
			/>
			<span class="text-muted-foreground w-10 text-right text-xs tabular-nums">{percent}%</span>
		</div>
	</Table.Cell>
	<Table.Cell>
		{#if project.isPublished}
			<Badge variant="success">{m.projects_published()}</Badge>
		{:else}
			<span class="text-muted-foreground" aria-hidden="true">—</span>
		{/if}
	</Table.Cell>
</Table.Row>
