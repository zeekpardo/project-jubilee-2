<script lang="ts">
	import { Combobox as ComboboxPrimitive } from '@ark-ui/svelte/combobox';
	import { cn } from '$lib/primitives/utils.js';

	type ComboboxItemProps = ComboboxPrimitive.ItemProps & {
		class?: string;
	};

	let { ref = $bindable(null), class: className, ...restProps }: ComboboxItemProps = $props();
</script>

<ComboboxPrimitive.Item
	bind:ref
	class={cn(
		"data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		className
	)}
	{...restProps}
/>
