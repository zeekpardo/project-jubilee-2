<script lang="ts">
	import { cn, type WithElementRef } from '$lib/primitives/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-scope="drawer"
	data-part="footer"
	class={cn('sticky bottom-0 mt-auto flex flex-col gap-2 pb-4', className)}
	{...restProps}
>
	{@render children?.()}
</div>
