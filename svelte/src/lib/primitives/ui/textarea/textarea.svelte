<script lang="ts" module>
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import type { WithElementRef, WithoutChildren } from '$lib/primitives/utils.js';

	export type TextareaProps = WithoutChildren<
		WithElementRef<HTMLTextareaAttributes, HTMLTextAreaElement>
	>;
</script>

<script lang="ts">
	import { cn } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		...restProps
	}: TextareaProps = $props();
</script>

<textarea
	bind:this={ref}
	bind:value
	data-slot="textarea"
	class={cn(
		'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
		className
	)}
	{...restProps}
></textarea>
