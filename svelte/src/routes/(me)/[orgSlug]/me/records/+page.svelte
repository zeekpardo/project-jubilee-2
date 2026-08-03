<script lang="ts">
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import ProjectCard from '$lib/features/public-site/ProjectCard.svelte';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();

	// The org comes from the URL, not the session: a person connected to records
	// at two orgs must see one org's at a time, and only the address says which.
	const orgSlug = $derived(page.params.orgSlug);

	const recordsResponse = useQuery(api.portal.queries.listPortalRecords, () =>
		auth.isAuthenticated && orgSlug ? { orgSlug } : 'skip'
	);
	const records = $derived(recordsResponse.data ?? []);
</script>

<svelte:head>
	<title>{m.portal_recordsTitle()}</title>
</svelte:head>

<header>
	<h1 class="ps-serif text-foreground text-3xl leading-tight">{m.portal_recordsTitle()}</h1>
	<p class="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
		{m.portal_recordsSubtitle()}
	</p>
</header>

{#if records.length === 0 || !orgSlug}
	<div class="mt-8">
		<EmptyState title={m.portal_recordsEmpty()} />
	</div>
{:else}
	<div class="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
		{#each records as record (record.card.number)}
			<div class="flex flex-col gap-2">
				<ProjectCard
					project={record.card}
					objectLabel={record.campaign.objectLabel}
					href={resolve('/(me)/[orgSlug]/me/records/[number]', {
						orgSlug,
						number: record.card.number
					})}
				/>
				{#if record.connection.belongsTo || record.connection.supports}
					<p class="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
						{#if record.connection.belongsTo}
							<span>{m.portal_connectionBelongsTo()}</span>
						{/if}
						{#if record.connection.supports}
							<span>{m.portal_connectionSupports()}</span>
						{/if}
					</p>
				{/if}
			</div>
		{/each}
	</div>
{/if}
