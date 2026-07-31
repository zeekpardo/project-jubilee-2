<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/primitives/utils';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import * as m from '$lib/i18n/messages';

	let {
		title,
		description,
		action,
		access = true,
		loading = false,
		class: className,
		children
	}: {
		title?: string;
		description?: string;
		action?: Snippet;
		/** When false the page renders a refusal instead of its content. */
		access?: boolean;
		loading?: boolean;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<div class={cn('flex flex-1 flex-col gap-6 p-4 md:p-8', className)}>
	{#if title || action}
		<div class="flex items-start justify-between gap-4">
			<div class="min-w-0">
				{#if title}
					<h1 class="text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1>
				{/if}
				{#if description}
					<p class="text-muted-foreground mt-1 text-sm">{description}</p>
				{/if}
			</div>
			{#if action}
				<div class="shrink-0">{@render action()}</div>
			{/if}
		</div>
	{/if}

	{#if !access}
		<EmptyState title={m.access_deniedTitle()} description={m.access_deniedBody()} />
	{:else if loading}
		<div class="flex flex-col gap-3">
			<Skeleton class="h-8 w-1/3" />
			<Skeleton class="h-24 w-full" />
			<Skeleton class="h-24 w-full" />
		</div>
	{:else}
		{@render children()}
	{/if}
</div>
