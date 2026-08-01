<script lang="ts">
	import { formatCents } from '$lib/features/money/format';
	import { cn } from '$lib/primitives/utils';
	import * as m from '$lib/i18n/messages';
	import { fundingCompleteLabel, fundingSentence, isFullyFunded } from './stage';

	let {
		raisedCents,
		targetCents,
		progress,
		isGoalMet,
		objectLabel,
		goalLabel,
		compact = false,
		class: className
	}: {
		raisedCents: number;
		targetCents: number | null;
		progress: number | null;
		isGoalMet: boolean;
		objectLabel: string;
		goalLabel: string;
		compact?: boolean;
		/** Optional, for layout composition (e.g. `mt-auto` on a card). */
		class?: string;
	} = $props();

	// Mirrors StageChip's status logic: a goal-met record reads as complete
	// regardless of progress, and a record can be fully raised (progress
	// reaching 1) before anyone marks its goal met.
	const complete = $derived(isGoalMet || isFullyFunded(progress));
	const pct = $derived(complete ? 100 : Math.round((progress ?? 0) * 100));
	const barWidth = $derived(Math.max(pct, 2));

	const sentence = $derived(
		fundingSentence({ isGoalMet, progress, goalLabel, objectLabel, targetCents, raisedCents })
	);
</script>

<div class={cn('space-y-1.5', className)}>
	<div
		role="progressbar"
		aria-valuemin={0}
		aria-valuemax={100}
		aria-valuenow={pct}
		aria-label={m.publicSite_fundingProgressLabel()}
		class="bg-secondary h-1.5 w-full overflow-hidden rounded-full"
	>
		<div
			class={cn(
				'h-full rounded-full transition-[width]',
				complete ? 'bg-primary' : 'from-primary to-accent bg-linear-to-r'
			)}
			style="width: {barWidth}%"
		></div>
	</div>
	<div
		class={cn(
			'text-muted-foreground flex items-baseline justify-between gap-2',
			compact ? 'text-xs' : 'text-sm'
		)}
	>
		{#if complete}
			<span class="text-foreground font-semibold">{fundingCompleteLabel(isGoalMet, goalLabel)}</span
			>
		{:else}
			<span>
				<span class="text-foreground font-semibold">{formatCents(raisedCents)}</span>
				{#if targetCents !== null && targetCents > 0}
					{' '}{m.publicSite_ofTargetRaised({ target: formatCents(targetCents) })}
				{/if}
			</span>
		{/if}
		<span class="tabular-nums">{pct}%</span>
	</div>

	{#if !compact}
		<p class="text-muted-foreground mt-1 text-sm leading-relaxed">{sentence}</p>
	{/if}
</div>
