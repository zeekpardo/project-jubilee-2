<script lang="ts" module>
	import type { HTMLAnchorAttributes } from 'svelte/elements';
	import { type VariantProps, tv } from 'tailwind-variants';
	import type { WithElementRef } from '$lib/primitives/utils.js';

	export const badgeVariants = tv({
		base: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 rounded-md inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] [&>svg]:pointer-events-none [&>svg:not([class*='size-'])]:size-3",
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground border-transparent',
				secondary: 'bg-secondary text-secondary-foreground border-transparent',
				outline: 'text-foreground border-border',
				destructive: 'bg-destructive text-error-contrast-500 border-transparent',
				success: 'bg-success-500 text-success-contrast-500 border-transparent',
				warning: 'bg-warning-500 text-warning-contrast-500 border-transparent'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	});

	export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
	export type BadgeVariants = VariantProps<typeof badgeVariants>;
	export type BadgeProps = WithElementRef<HTMLAnchorAttributes> & {
		variant?: BadgeVariant;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		href = undefined,
		children,
		...restProps
	}: BadgeProps = $props();
</script>

<svelte:element
	this={href ? 'a' : 'span'}
	bind:this={ref}
	{href}
	data-slot="badge"
	class={cn(badgeVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
