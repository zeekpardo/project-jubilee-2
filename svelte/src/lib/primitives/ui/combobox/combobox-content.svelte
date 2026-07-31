<script lang="ts">
	import { Combobox as ComboboxPrimitive } from '@ark-ui/svelte/combobox';
	import { cn } from '$lib/primitives/utils.js';

	type ComboboxContentProps = ComboboxPrimitive.ContentProps & {
		class?: string;
	};

	let { ref = $bindable(null), class: className, ...restProps }: ComboboxContentProps = $props();
</script>

<ComboboxPrimitive.Content
	bind:ref
	class={cn(
		'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[placement^=bottom]:slide-in-from-top-2 data-[placement^=left]:slide-in-from-right-2 data-[placement^=right]:slide-in-from-left-2 data-[placement^=top]:slide-in-from-bottom-2 relative z-50 max-h-96 min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md',
		className
	)}
	{...restProps}
/>
