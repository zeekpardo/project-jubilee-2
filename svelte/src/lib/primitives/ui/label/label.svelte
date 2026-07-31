<script lang="ts" module>
	import type { HTMLLabelAttributes } from 'svelte/elements';
	import type { WithElementRef } from '$lib/primitives/utils.js';

	export type LabelProps = WithElementRef<HTMLLabelAttributes, HTMLLabelElement>;
</script>

<script lang="ts">
	import { cn } from '$lib/primitives/utils.js';

	let { ref = $bindable(null), class: className, children, ...restProps }: LabelProps = $props();
</script>

<label
	bind:this={ref}
	data-slot="label"
	class={cn(
		'text-foreground flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled]:pointer-events-none group-data-[disabled]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</label>
