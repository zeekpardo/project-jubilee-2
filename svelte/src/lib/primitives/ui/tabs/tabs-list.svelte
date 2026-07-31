<script lang="ts">
	import { Tabs as TabsPrimitive } from '@ark-ui/svelte/tabs';
	import { cn } from '$lib/primitives/utils.js';

	let { ref = $bindable(null), class: className, ...restProps }: TabsPrimitive.ListProps = $props();
</script>

<TabsPrimitive.List
	bind:ref
	data-slot="tabs-list"
	class={cn(
		'bg-muted text-muted-foreground rounded-lg p-[3px]',
		'inline-flex items-center justify-center',
		'data-[orientation=horizontal]:h-9 data-[orientation=horizontal]:w-fit',
		'data-[orientation=vertical]:h-fit data-[orientation=vertical]:w-full data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-start data-[orientation=vertical]:justify-start',
		className
	)}
	{...restProps}
/>
