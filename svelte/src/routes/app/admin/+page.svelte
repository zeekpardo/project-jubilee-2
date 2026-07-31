<script lang="ts">
	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import { ADMIN_NAV } from '$lib/shell/nav-config';
	import { itemLabel } from '$lib/shell/nav-labels';
	import { resolve } from '$app/paths';
	import * as Card from '$lib/primitives/ui/card';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import * as m from '$lib/i18n/messages';

	const access = getAccessContext();
	const items = $derived(ADMIN_NAV.filter((item) => access.can(item.capability)));
</script>

<PageContainer title={m.nav_section_admin()} description={m.org_subtitle()}>
	{#if items.length === 0}
		<EmptyState title={m.access_deniedTitle()} description={m.access_deniedBody()} />
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each items as item (item.key)}
				{@const Icon = item.icon}
				<a href={resolve(item.href)} class="block">
					<Card.Root class="hover:border-primary/50 h-full transition-colors">
						<Card.Header>
							<Icon class="text-muted-foreground size-5" />
							<Card.Title class="mt-2 text-base">{itemLabel(item.key)}</Card.Title>
						</Card.Header>
					</Card.Root>
				</a>
			{/each}
		</div>
	{/if}
</PageContainer>
