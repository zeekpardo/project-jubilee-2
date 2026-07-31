<script lang="ts">
	import { Badge } from '$lib/primitives/ui/badge';
	import { stageLabel, type PipelineStage } from '$lib/domain/stages';
	import { stageVariant } from './stages';

	let {
		stage,
		stages,
		class: className
	}: { stage: string; stages: PipelineStage[]; class?: string } = $props();

	const match = $derived(stages.find((candidate) => candidate.key === stage));
</script>

<Badge variant={stageVariant(match)} class={className}>{stageLabel(stages, stage)}</Badge>
