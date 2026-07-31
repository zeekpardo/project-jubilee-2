<script lang="ts">
	import { Checkbox as CheckboxPrimitive } from '@ark-ui/svelte/checkbox';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import { cn } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		class: className,
		controlClass,
		labelClass,
		children,
		...restProps
	}: CheckboxPrimitive.RootProps & {
		controlClass?: string;
		labelClass?: string;
	} = $props();
</script>

<CheckboxPrimitive.Root
	bind:ref
	bind:checked
	data-slot="checkbox"
	class={cn(
		'group text-foreground inline-flex items-center gap-2 text-sm leading-none font-medium select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
		className
	)}
	{...restProps}
>
	<CheckboxPrimitive.Control
		data-slot="checkbox-control"
		class={cn(
			'border-border data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 dark:bg-input/30 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border shadow-xs transition-[color,background-color,box-shadow] outline-none focus-visible:ring-[3px]',
			controlClass
		)}
	>
		<CheckboxPrimitive.Indicator>
			<CheckIcon class="size-3.5" aria-hidden="true" />
		</CheckboxPrimitive.Indicator>
		<CheckboxPrimitive.Indicator indeterminate>
			<MinusIcon class="size-3.5" aria-hidden="true" />
		</CheckboxPrimitive.Indicator>
	</CheckboxPrimitive.Control>
	{#if children}
		<CheckboxPrimitive.Label data-slot="checkbox-label" class={cn('cursor-pointer', labelClass)}>
			{@render children()}
		</CheckboxPrimitive.Label>
	{/if}
	<CheckboxPrimitive.HiddenInput />
</CheckboxPrimitive.Root>
