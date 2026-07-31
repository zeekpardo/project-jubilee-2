<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';
	import { type VariantProps, tv } from 'tailwind-variants';
	import type { WithElementRef } from '$lib/primitives/utils.js';

	export const alertVariants = tv({
		base: 'rounded-lg relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
		variants: {
			variant: {
				default: 'bg-card text-card-foreground',
				destructive:
					'bg-destructive/10 text-destructive border-destructive/40 *:data-[slot=alert-description]:text-destructive/90',
				warning:
					'bg-warning-500/10 text-warning-700-300 border-warning-500/40 *:data-[slot=alert-description]:text-warning-700-300/90',
				success:
					'bg-success-500/10 text-success-700-300 border-success-500/40 *:data-[slot=alert-description]:text-success-700-300/90'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	});

	export type AlertVariant = VariantProps<typeof alertVariants>['variant'];
	export type AlertVariants = VariantProps<typeof alertVariants>;
	export type AlertProps = WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
		variant?: AlertVariant;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		children,
		...restProps
	}: AlertProps = $props();
</script>

<div
	bind:this={ref}
	role="alert"
	data-slot="alert"
	class={cn(alertVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
