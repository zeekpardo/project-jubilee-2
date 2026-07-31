<script lang="ts">
	import { useAccess, setAccessContext } from '$lib/access';
	import {
		createActiveCampaign,
		setActiveCampaignContext,
		type CampaignSummary
	} from '$lib/campaigns/active.svelte';
	import AppSidebar from '$lib/shell/AppSidebar.svelte';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import * as m from '$lib/i18n/messages';

	let { data, children } = $props();

	const access = useAccess(() => ({ initialData: data.access }));
	setAccessContext(access);

	const activeCampaign = createActiveCampaign(
		() => (data.campaigns ?? []) as CampaignSummary[],
		() => data.activeCampaignId ?? null
	);
	setActiveCampaignContext(activeCampaign);
</script>

{#if !access.canAccessAdmin}
	<div class="flex min-h-[60vh] items-center justify-center p-8">
		<EmptyState title={m.access_deniedTitle()} description={m.access_deniedBody()} />
	</div>
{:else}
	<div class="flex min-h-[calc(100dvh-4rem)]">
		<aside class="hidden w-64 shrink-0 md:block">
			<AppSidebar class="sticky top-16" />
		</aside>
		<div class="bg-card flex min-w-0 flex-1 flex-col border-t md:border-t-0 md:border-l">
			{@render children?.()}
		</div>
	</div>
{/if}
