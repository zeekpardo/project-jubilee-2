<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { HTMLLiAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLLiAttributes, HTMLLIElement> = $props();
</script>

<li
	bind:this={ref}
	role="presentation"
	aria-hidden="true"
	data-slot="breadcrumb-separator"
	class={cn("[&>svg:not([class*='size-'])]:size-3.5", className)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{:else}
		<ChevronRightIcon />
	{/if}
</li>
