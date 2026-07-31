<script lang="ts">
	import { Combobox as ComboboxPrimitive } from '@ark-ui/svelte/combobox';
	import { cn } from '$lib/primitives/utils.js';

	type ComboboxItemGroupLabelProps = ComboboxPrimitive.ItemGroupLabelProps & {
		class?: string;
	};

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: ComboboxItemGroupLabelProps = $props();
</script>

<ComboboxPrimitive.ItemGroupLabel
	bind:ref
	class={cn('text-muted-foreground px-2 py-1.5 text-xs font-medium', className)}
	{...restProps}
/>
