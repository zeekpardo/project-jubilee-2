<script lang="ts" module>
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';
	import type { WithElementRef, WithoutChildren } from '$lib/primitives/utils.js';

	type InputType = Exclude<HTMLInputTypeAttribute, 'file'>;

	export type InputProps = WithoutChildren<
		WithElementRef<Omit<HTMLInputAttributes, 'type'>, HTMLInputElement>
	> &
		({ type: 'file'; files?: FileList | null } | { type?: InputType; files?: undefined });
</script>

<script lang="ts">
	import { cn } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		value = $bindable(),
		files = $bindable(),
		class: className,
		type = 'text',
		...restProps
	}: InputProps = $props();
</script>

{#if type === 'file'}
	<input
		bind:this={ref}
		bind:value
		bind:files
		type="file"
		data-slot="input"
		class={cn(
			'border-input placeholder:text-muted-foreground file:text-foreground selection:bg-primary selection:text-primary-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 dark:bg-input/30 flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
			className
		)}
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		bind:value
		{type}
		data-slot="input"
		class={cn(
			'border-input placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 dark:bg-input/30 flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
			className
		)}
		{...restProps}
	/>
{/if}
