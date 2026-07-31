<script lang="ts">
	import type { HTMLAttributes, HTMLTableAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		containerClass,
		containerProps,
		children,
		...restProps
	}: WithElementRef<HTMLTableAttributes, HTMLTableElement> & {
		containerClass?: string;
		containerProps?: HTMLAttributes<HTMLDivElement>;
	} = $props();
</script>

<div
	data-slot="table-container"
	class={cn('relative w-full overflow-x-auto', containerClass)}
	{...containerProps}
>
	<table
		bind:this={ref}
		data-slot="table"
		class={cn('w-full caption-bottom text-sm', className)}
		{...restProps}
	>
		{@render children?.()}
	</table>
</div>
