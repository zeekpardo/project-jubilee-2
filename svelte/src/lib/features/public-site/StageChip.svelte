<script lang="ts">
	import { cn } from '$lib/primitives/utils';
	import { isFullyFunded, publicStatusLabel } from './stage';

	let {
		isGoalMet,
		goalLabel,
		progress,
		class: className
	}: {
		isGoalMet: boolean;
		goalLabel: string;
		progress: number | null;
		/** Optional, for absolute-positioning the chip over a photo (ProjectCard). */
		class?: string;
	} = $props();

	const funded = $derived(!isGoalMet && isFullyFunded(progress));
	const label = $derived(publicStatusLabel(isGoalMet, goalLabel, progress));
</script>

<span
	class={cn(
		'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide uppercase',
		isGoalMet && 'bg-primary text-primary-foreground',
		funded && 'bg-accent text-accent-foreground',
		!isGoalMet && !funded && 'bg-card text-muted-foreground ring-border ring-1',
		className
	)}
>
	<span
		aria-hidden="true"
		class={cn(
			'size-1.5 rounded-full',
			isGoalMet && 'bg-primary-foreground/80',
			funded && 'bg-accent-foreground/70',
			!isGoalMet && !funded && 'bg-accent'
		)}
	></span>
	{label}
</span>
