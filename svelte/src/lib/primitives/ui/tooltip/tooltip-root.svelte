<script lang="ts">
	import { Tooltip as TooltipPrimitive } from '@ark-ui/svelte/tooltip';

	let {
		open = $bindable(false),
		openDelay = 200,
		closeDelay = 100,
		...restProps
	}: TooltipPrimitive.RootProps = $props();
</script>

<TooltipPrimitive.Root bind:open {openDelay} {closeDelay} {...restProps} />
