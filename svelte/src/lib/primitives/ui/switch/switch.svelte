<script lang="ts">
	import { Switch as SwitchPrimitive } from '@ark-ui/svelte/switch';
	import { cn } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		class: className,
		controlClass,
		thumbClass,
		labelClass,
		children,
		...restProps
	}: SwitchPrimitive.RootProps & {
		controlClass?: string;
		thumbClass?: string;
		labelClass?: string;
	} = $props();
</script>

<SwitchPrimitive.Root
	bind:ref
	bind:checked
	data-slot="switch"
	class={cn(
		'group text-foreground inline-flex items-center gap-2 text-sm leading-none font-medium select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
		className
	)}
	{...restProps}
>
	<SwitchPrimitive.Control
		data-slot="switch-control"
		class={cn(
			'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent p-px shadow-xs transition-all outline-none focus-visible:ring-[3px]',
			controlClass
		)}
	>
		<SwitchPrimitive.Thumb
			data-slot="switch-thumb"
			class={cn(
				'bg-background pointer-events-none block size-4 rounded-full shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
				thumbClass
			)}
		/>
	</SwitchPrimitive.Control>
	{#if children}
		<SwitchPrimitive.Label data-slot="switch-label" class={cn('cursor-pointer', labelClass)}>
			{@render children()}
		</SwitchPrimitive.Label>
	{/if}
	<SwitchPrimitive.HiddenInput />
</SwitchPrimitive.Root>
