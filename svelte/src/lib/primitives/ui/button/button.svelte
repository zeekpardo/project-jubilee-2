<script lang="ts" module>
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { type VariantProps, tv } from 'tailwind-variants';
	import type { WithElementRef } from '$lib/primitives/utils.js';

	export const buttonVariants = tv({
		base: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 rounded-md inline-flex shrink-0 items-center justify-center gap-2 text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] outline-none select-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
				secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
				outline:
					'border-border bg-background hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:hover:bg-input/50 border shadow-xs',
				ghost: 'hover:bg-accent hover:text-accent-foreground',
				destructive:
					'bg-destructive text-error-contrast-500 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 shadow-xs hover:bg-destructive/90',
				link: 'text-foreground underline-offset-4 hover:underline'
			},
			size: {
				sm: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
				default: 'h-9 px-4 py-2 has-[>svg]:px-3',
				lg: 'h-10 px-6 has-[>svg]:px-4',
				icon: 'size-9'
			}
		},
		defaultVariants: {
			variant: 'default',
			size: 'default'
		}
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
	export type ButtonSize = VariantProps<typeof buttonVariants>['size'];
	export type ButtonVariants = VariantProps<typeof buttonVariants>;

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
			loading?: boolean;
		};
</script>

<script lang="ts">
	import Spinner from '$lib/primitives/ui/spinner/spinner.svelte';
	import { cn } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		size = 'default',
		href = undefined,
		type = 'button',
		disabled = false,
		loading = false,
		children,
		...restProps
	}: ButtonProps = $props();

	const isDisabled = $derived(disabled || loading);
	const spinnerSize = $derived(size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : 'default');
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->
{#if href}
	<a
		bind:this={ref}
		{href}
		data-slot="button"
		data-loading={loading ? '' : undefined}
		aria-disabled={isDisabled || undefined}
		aria-busy={loading || undefined}
		tabindex={isDisabled ? -1 : undefined}
		class={cn(buttonVariants({ variant, size }), className)}
		{...restProps}
	>
		{#if loading}
			<Spinner size={spinnerSize} aria-hidden="true" />
		{/if}
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		{type}
		data-slot="button"
		data-loading={loading ? '' : undefined}
		disabled={isDisabled}
		aria-busy={loading || undefined}
		class={cn(buttonVariants({ variant, size }), className)}
		{...restProps}
	>
		{#if loading}
			<Spinner size={spinnerSize} aria-hidden="true" />
		{/if}
		{@render children?.()}
	</button>
{/if}
