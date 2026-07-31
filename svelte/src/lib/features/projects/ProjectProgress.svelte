<script lang="ts">
	import { Progress } from '$lib/primitives/ui/progress';
	import { formatCents, progressPercent } from './format';

	let {
		raisedCents,
		targetCents,
		showAmounts = false,
		class: className
	}: {
		raisedCents: number;
		targetCents: number;
		showAmounts?: boolean;
		class?: string;
	} = $props();

	const percent = $derived(progressPercent(raisedCents, targetCents));
</script>

<div class={className}>
	<Progress value={percent} />
	{#if showAmounts}
		<p class="text-muted-foreground mt-2 text-sm tabular-nums">
			{formatCents(raisedCents)} / {formatCents(targetCents)} · {percent}%
		</p>
	{/if}
</div>
