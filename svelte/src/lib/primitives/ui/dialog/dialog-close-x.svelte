<script lang="ts">
	import { Dialog as DialogPrimitive } from '@ark-ui/svelte/dialog';
	import { XIcon } from '@lucide/svelte';

	let { ref = $bindable(null), ...restProps }: DialogPrimitive.CloseTriggerProps = $props();
</script>

<DialogPrimitive.CloseTrigger
	bind:ref
	data-scope="dialog"
	data-part="close"
	class="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-xs p-2 opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
	type="button"
	{...restProps}
>
	<XIcon />
	<span class="sr-only">Close</span>
</DialogPrimitive.CloseTrigger>
