<script lang="ts">
	import { Tooltip as TooltipPrimitive } from '@ark-ui/svelte/tooltip';
	import { Portal as PortalPrimitive, type PortalProps } from '@ark-ui/svelte/portal';
	import { cn } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		portalProps,
		positionerProps,
		...restProps
	}: TooltipPrimitive.ContentProps & {
		portalProps?: PortalProps;
		positionerProps?: TooltipPrimitive.PositionerProps;
	} = $props();
</script>

<PortalPrimitive {...portalProps}>
	<TooltipPrimitive.Positioner {...positionerProps}>
		<TooltipPrimitive.Content
			bind:ref
			data-slot="tooltip-content"
			class={cn(
				'bg-primary text-primary-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 [&[data-placement^="bottom"]]:slide-in-from-top-1 [&[data-placement^="left"]]:slide-in-from-right-1 [&[data-placement^="right"]]:slide-in-from-left-1 [&[data-placement^="top"]]:slide-in-from-bottom-1 z-50 w-fit origin-[var(--transform-origin)] rounded-md px-3 py-1.5 text-xs text-balance outline-none',
				className
			)}
			{...restProps}
		/>
	</TooltipPrimitive.Positioner>
</PortalPrimitive>
