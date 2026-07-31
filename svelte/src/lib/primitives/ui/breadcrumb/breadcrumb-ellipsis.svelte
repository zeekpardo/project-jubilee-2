<script lang="ts">
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> = $props();
</script>

<span
	bind:this={ref}
	role="presentation"
	aria-hidden="true"
	data-slot="breadcrumb-ellipsis"
	class={cn('flex size-9 items-center justify-center', className)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{:else}
		<EllipsisIcon class="size-4" />
	{/if}
	<span class="sr-only">More</span>
</span>
