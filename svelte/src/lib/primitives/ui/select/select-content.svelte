<script lang="ts">
	import { Select as SelectPrimitive } from '@ark-ui/svelte/select';
	import { cn, type WithoutChild } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<SelectPrimitive.ContentProps> = $props();
</script>

<SelectPrimitive.Positioner>
	<SelectPrimitive.Content
		bind:ref
		data-slot="select-content"
		class={cn(
			// Ark/zag only ever set `data-placement` (e.g. "bottom-start") — never
			// `data-side` — so the slide/offset variants must key off a prefix match
			// or they silently never apply.
			'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[placement^=bottom]:slide-in-from-top-2 data-[placement^=left]:slide-in-from-right-2 data-[placement^=right]:slide-in-from-left-2 data-[placement^=top]:slide-in-from-bottom-2 relative z-50 max-h-(--available-height) w-(--reference-width) min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md data-[placement^=bottom]:translate-y-1 data-[placement^=left]:-translate-x-1 data-[placement^=right]:translate-x-1 data-[placement^=top]:-translate-y-1',
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</SelectPrimitive.Content>
</SelectPrimitive.Positioner>
