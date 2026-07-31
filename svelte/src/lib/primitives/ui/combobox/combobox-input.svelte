<script lang="ts">
	import { Combobox as ComboboxPrimitive } from '@ark-ui/svelte/combobox';
	import { cn } from '$lib/primitives/utils.js';

	type ComboboxInputProps = ComboboxPrimitive.InputProps & {
		class?: string;
	};

	let { ref = $bindable(null), class: className, ...restProps }: ComboboxInputProps = $props();
</script>

<ComboboxPrimitive.Input
	bind:ref
	class={cn(
		'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 dark:bg-input/30 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 pr-10 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
		className
	)}
	{...restProps}
/>
