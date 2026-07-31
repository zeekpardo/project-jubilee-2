<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';
	import { type VariantProps, tv } from 'tailwind-variants';
	import type { WithoutChildren, WithElementRef } from '$lib/primitives/utils.js';

	export const spinnerVariants = tv({
		base: 'inline-flex shrink-0 items-center justify-center text-current',
		variants: {
			size: {
				xs: 'size-3',
				sm: 'size-3.5',
				default: 'size-4',
				lg: 'size-6',
				xl: 'size-8'
			}
		},
		defaultVariants: {
			size: 'default'
		}
	});

	export type SpinnerSize = VariantProps<typeof spinnerVariants>['size'];
	export type SpinnerVariants = VariantProps<typeof spinnerVariants>;
	export type SpinnerProps = WithoutChildren<WithElementRef<HTMLAttributes<HTMLElement>>> & {
		size?: SpinnerSize;
		label?: string;
	};
</script>

<script lang="ts">
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { cn } from '$lib/primitives/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		size = 'default',
		label = 'Loading',
		...restProps
	}: SpinnerProps = $props();
</script>

<span
	bind:this={ref}
	data-slot="spinner"
	role="status"
	aria-label={label}
	class={cn(spinnerVariants({ size }), className)}
	{...restProps}
>
	<LoaderCircleIcon class="size-full animate-spin" aria-hidden="true" />
</span>
