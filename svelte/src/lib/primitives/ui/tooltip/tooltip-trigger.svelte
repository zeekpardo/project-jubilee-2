<script lang="ts">
	import { Tooltip as TooltipPrimitive } from '@ark-ui/svelte/tooltip';

	let { ref = $bindable(null), ...restProps }: TooltipPrimitive.TriggerProps = $props();
</script>

<TooltipPrimitive.Trigger bind:ref data-slot="tooltip-trigger" {...restProps} />
