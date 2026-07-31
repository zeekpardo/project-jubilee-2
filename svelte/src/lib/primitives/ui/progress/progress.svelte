<script lang="ts">
	import { Progress as ProgressPrimitive } from '@ark-ui/svelte/progress';
	import { cn, type WithoutChildren } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		value = $bindable(0),
		class: className,
		trackClass,
		rangeClass,
		labelClass,
		label,
		showValue = false,
		...restProps
	}: WithoutChildren<ProgressPrimitive.RootProps> & {
		trackClass?: string;
		rangeClass?: string;
		labelClass?: string;
		label?: string;
		showValue?: boolean;
	} = $props();
</script>

<ProgressPrimitive.Root
	bind:ref
	bind:value
	data-slot="progress"
	class={cn('flex w-full flex-col gap-2', className)}
	{...restProps}
>
	{#if label || showValue}
		<div class={cn('flex items-center gap-2 text-sm leading-none', labelClass)}>
			{#if label}
				<ProgressPrimitive.Label data-slot="progress-label" class="text-foreground font-medium">
					{label}
				</ProgressPrimitive.Label>
			{/if}
			{#if showValue}
				<ProgressPrimitive.ValueText
					data-slot="progress-value-text"
					class="text-muted-foreground ml-auto tabular-nums"
				/>
			{/if}
		</div>
	{/if}
	<ProgressPrimitive.Track
		data-slot="progress-track"
		class={cn('bg-muted relative h-2 w-full overflow-hidden rounded-full', trackClass)}
	>
		<ProgressPrimitive.Range
			data-slot="progress-range"
			class={cn('bg-primary h-full transition-[width] duration-300 ease-out', rangeClass)}
		/>
	</ProgressPrimitive.Track>
</ProgressPrimitive.Root>
