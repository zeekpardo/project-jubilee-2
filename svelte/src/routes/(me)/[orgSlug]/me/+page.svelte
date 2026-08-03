<script lang="ts">
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { formatCents } from '$lib/features/money/format';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();

	// Every read on these pages names the org from the URL rather than from the
	// session. The same person can hold a record at more than one org, and the
	// address is the only thing that says which one they are looking at.
	const orgSlug = $derived(page.params.orgSlug);

	const overviewResponse = useQuery(api.portal.queries.getPortalOverview, () =>
		auth.isAuthenticated && orgSlug ? { orgSlug } : 'skip'
	);
	const overview = $derived(overviewResponse.data);

	const figures = $derived(
		overview && orgSlug
			? [
					{
						key: 'giving',
						href: resolve('/(me)/[orgSlug]/me/giving', { orgSlug }),
						value: formatCents(overview.giving.lifetimeCents),
						label: m.portal_lifetimeGiving()
					},
					{
						key: 'gifts',
						href: resolve('/(me)/[orgSlug]/me/giving', { orgSlug }),
						value: overview.giving.giftCount.toLocaleString('en-US'),
						label: m.portal_giftCount()
					},
					{
						key: 'records',
						href: resolve('/(me)/[orgSlug]/me/records', { orgSlug }),
						value: overview.recordCount.toLocaleString('en-US'),
						label: m.portal_recordCount()
					}
				]
			: []
	);
</script>

<svelte:head>
	<title>{m.portal_navHome()}</title>
</svelte:head>

{#if overview}
	<p class="text-muted-foreground max-w-xl text-base leading-relaxed">
		{m.portal_greetingSubtitle()}
	</p>

	<div class="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
		<!-- Every href here is already a resolve() of a literal route id; the rule
		     only recognises the call at the attribute itself. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		{#each figures as figure (figure.key)}
			<a
				href={figure.href}
				class="group bg-card ring-border hover:ring-primary/40 focus-visible:ring-ring rounded-xl p-5 shadow-xs ring-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:outline-none"
			>
				<p class="ps-serif text-primary text-3xl tabular-nums">{figure.value}</p>
				<p class="text-muted-foreground mt-1 text-[11px] font-medium tracking-[0.18em] uppercase">
					{figure.label}
				</p>
			</a>
		{/each}
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>
{/if}
