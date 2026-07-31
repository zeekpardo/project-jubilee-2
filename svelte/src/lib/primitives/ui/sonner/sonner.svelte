<script lang="ts">
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from 'svelte-sonner';
	// Icons
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import InfoIcon from '@lucide/svelte/icons/info';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';

	let { ...restProps }: SonnerProps = $props();
</script>

<Sonner
	toastOptions={{
		unstyled: true,
		classes: {
			toast:
				'bg-background text-foreground border-border flex w-full flex-row items-start gap-2 rounded-md border p-3 font-medium shadow-lg transition-all pointer-events-auto md:w-96',
			title: 'break-words text-sm font-medium leading-tight',
			description: 'text-muted-foreground mt-1 line-clamp-2 text-xs',
			action: '',
			actionButton: '',
			cancelButton: '',
			closeButton:
				'hover:bg-accent hover:text-accent-foreground ml-auto rounded-md p-1 text-xs order-last',
			default: 'bg-background text-foreground',
			info: 'bg-background text-foreground',
			success: 'bg-background text-foreground',
			error: 'bg-destructive text-white border-transparent',
			loading: 'bg-background text-foreground',
			warning: 'bg-background text-foreground'
		}
	}}
	{...restProps}
>
	{#snippet loadingIcon()}
		<Loader2Icon class="flex-shrink-0 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<CircleCheckIcon class="text-success-500 flex-shrink-0" />
	{/snippet}
	{#snippet errorIcon()}
		<CircleXIcon class="text-error-500 flex-shrink-0" />
	{/snippet}
	{#snippet infoIcon()}
		<InfoIcon class="flex-shrink-0" />
	{/snippet}
	{#snippet warningIcon()}
		<AlertTriangleIcon class="flex-shrink-0" />
	{/snippet}
</Sonner>

<style>
	:global(.sonner-loader) {
		position: static !important;
		transform: none !important;
	}
</style>
