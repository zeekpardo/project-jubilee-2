<script lang="ts">
	import type { HTMLAnchorAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		href = undefined,
		children,
		...restProps
	}: WithElementRef<HTMLAnchorAttributes, HTMLAnchorElement> = $props();
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->
<a
	bind:this={ref}
	{href}
	data-slot="breadcrumb-link"
	class={cn('hover:text-foreground transition-colors', className)}
	{...restProps}
>
	{@render children?.()}
</a>
