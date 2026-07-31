<script lang="ts">
	import { Dialog as DialogPrimitive } from '@ark-ui/svelte/dialog';
	import { Portal as PortalPrimitive, type PortalProps } from '@ark-ui/svelte/portal';
	import type { Snippet } from 'svelte';
	import * as Dialog from './index.js';
	import { cn, type WithoutChildrenOrChild } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		// onInteractOutside,
		portalProps,
		positionerProps,
		children,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
		portalProps?: PortalProps;
		positionerProps?: DialogPrimitive.PositionerProps;
		children: Snippet;
	} = $props();
</script>

<PortalPrimitive {...portalProps}>
	<Dialog.Backdrop />
	<DialogPrimitive.Positioner {...positionerProps}>
		<DialogPrimitive.Content
			bind:ref
			class={cn(
				'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-x-hidden overflow-y-auto rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg',
				className
			)}
			{...restProps}
		>
			{@render children?.()}
		</DialogPrimitive.Content>
	</DialogPrimitive.Positioner>
</PortalPrimitive>
