<script lang="ts">
	import { Combobox as ComboboxPrimitive } from '@ark-ui/svelte/combobox';
	import { cn } from '$lib/primitives/utils.js';

	type ComboboxLabelProps = ComboboxPrimitive.LabelProps & {
		class?: string;
	};

	let { ref = $bindable(null), class: className, ...restProps }: ComboboxLabelProps = $props();
</script>

<ComboboxPrimitive.Label
	bind:ref
	class={cn(
		'text-foreground text-sm leading-none font-medium select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
		className
	)}
	{...restProps}
/>
