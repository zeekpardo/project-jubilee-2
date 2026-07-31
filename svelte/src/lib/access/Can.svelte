<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Capability } from '$lib/domain/permissions';
	import { getAccessContext } from './context.svelte';

	let {
		do: capability,
		campaignId = null,
		children,
		fallback
	}: {
		do: Capability;
		campaignId?: string | null;
		children: Snippet;
		fallback?: Snippet;
	} = $props();

	const access = getAccessContext();
	const allowed = $derived(access.can(capability, campaignId));
</script>

{#if allowed}
	{@render children()}
{:else if fallback}
	{@render fallback()}
{/if}
