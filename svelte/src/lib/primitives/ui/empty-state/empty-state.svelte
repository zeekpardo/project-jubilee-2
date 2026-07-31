<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { type VariantProps, tv } from 'tailwind-variants';
	import type { WithElementRef } from '$lib/primitives/utils.js';

	export const emptyStateVariants = tv({
		base: 'flex w-full flex-col items-center justify-center text-center',
		variants: {
			variant: {
				default: 'border-border bg-card/50 rounded-xl border border-dashed',
				plain: 'bg-transparent'
			},
			size: {
				sm: 'gap-2 px-4 py-8',
				default: 'gap-3 px-6 py-12',
				lg: 'gap-4 px-8 py-20'
			}
		},
		defaultVariants: {
			variant: 'default',
			size: 'default'
		}
	});

	export type EmptyStateVariant = VariantProps<typeof emptyStateVariants>['variant'];
	export type EmptyStateSize = VariantProps<typeof emptyStateVariants>['size'];
	export type EmptyStateVariants = VariantProps<typeof emptyStateVariants>;
	export type EmptyStateProps = WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
		variant?: EmptyStateVariant;
		size?: EmptyStateSize;
		title?: string;
		description?: string;
		icon?: Snippet;
		action?: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/primitives/utils.js';
	import Action from './empty-state-action.svelte';
	import Description from './empty-state-description.svelte';
	import Icon from './empty-state-icon.svelte';
	import Title from './empty-state-title.svelte';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		size = 'default',
		title,
		description,
		icon,
		action,
		children,
		...restProps
	}: EmptyStateProps = $props();
</script>

<div
	bind:this={ref}
	data-slot="empty-state"
	class={cn(emptyStateVariants({ variant, size }), className)}
	{...restProps}
>
	{#if icon}
		<Icon>{@render icon()}</Icon>
	{/if}
	{#if title}
		<Title>{title}</Title>
	{/if}
	{#if description}
		<Description>{description}</Description>
	{/if}
	{@render children?.()}
	{#if action}
		<Action>{@render action()}</Action>
	{/if}
</div>
