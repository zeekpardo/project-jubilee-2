<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/primitives/utils';
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

{#if !access}
	<div class="flex flex-1 items-center justify-center p-4 md:px-6">
		<div class="text-muted-foreground text-center text-lg">
			<p>{m.access_deniedTitle()}</p>
			<p class="mt-1 text-sm">{m.access_deniedBody()}</p>
		</div>
	</div>
{:else if loading}
	<div class="flex flex-1 animate-pulse flex-col gap-4 p-4 md:px-6">
		<div class="bg-muted mb-2 h-8 w-48 rounded"></div>
		<div class="bg-muted h-4 w-96 rounded"></div>
		<div class="bg-muted mt-6 h-40 w-full rounded-lg"></div>
		<div class="bg-muted h-40 w-full rounded-lg"></div>
	</div>
{:else}
	<div class={cn('flex min-w-0 flex-1 flex-col px-4 pt-2 pb-4 md:px-6 md:pt-4', className)}>
		{#if title || action}
			<div class="mb-4 flex items-start justify-between gap-4">
				<div class="min-w-0">
					{#if title}
						<div class="flex items-center gap-2">
							<h2 class="text-3xl font-bold tracking-tight">{title}</h2>
						</div>
					{/if}
					{#if description}
						<p class="text-muted-foreground text-sm">{description}</p>
					{/if}
				</div>
				{#if action}
					<div class="shrink-0">{@render action()}</div>
				{/if}
			</div>
		{/if}

		<!-- Pages hand over several stacked blocks, so the gap lives here rather
		     than being repeated by every caller. -->
		<div class="flex min-w-0 flex-1 flex-col gap-4">
			{@render children()}
		</div>
	</div>
{/if}
