<script lang="ts">
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Badge } from '$lib/primitives/ui/badge';
	import * as m from '$lib/i18n/messages';
	import { formatTripDateRange } from '$lib/features/trips/format';

	const { api } = getAuthContext();
	const auth = useAuth();

	// The org comes from the URL, not the session — the same rule every portal
	// page follows, and the reason a slug is not an identity.
	// Empty rather than undefined: the query below skips on a falsy slug, and a
	// server read with '' resolves to no viewer, so neither path can leak.
	const orgSlug = $derived(page.params.orgSlug ?? '');

	const tripsResponse = useQuery(api.portal.trips.listPortalTrips, () =>
		auth.isAuthenticated && orgSlug ? { orgSlug } : 'skip'
	);
	const trips = $derived(tripsResponse.data ?? []);
</script>

<svelte:head>
	<title>{m.portal_tripsTitle()}</title>
</svelte:head>

<header>
	<h1 class="ps-serif text-foreground text-3xl leading-tight">{m.portal_tripsTitle()}</h1>
	<p class="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
		{m.portal_tripsSubtitle()}
	</p>
</header>

{#if !tripsResponse.isLoading && trips.length === 0}
	<EmptyState title={m.portal_tripsEmpty()} description={m.portal_tripsEmptyBody()} />
{:else}
	<ul class="mt-6 flex flex-col gap-3">
		{#each trips as trip (trip.id)}
			<li>
				<a
					href={resolve('/(me)/[orgSlug]/me/trips/[tripId]', { orgSlug, tripId: trip.id })}
					class="border-border hover:bg-muted/40 flex flex-col gap-1 rounded-lg border p-4 transition-colors"
				>
					<span class="flex flex-wrap items-center gap-2">
						<span class="text-foreground font-medium">{trip.name}</span>
						{#if trip.amLeader}
							<Badge variant="secondary">{m.tripDetail_leaderToggle()}</Badge>
						{/if}
						{#if trip.myRole}
							<Badge variant="outline">{trip.myRole}</Badge>
						{/if}
					</span>
					<span class="text-muted-foreground text-sm">
						{formatTripDateRange(trip.startOn, trip.endOn)} · {trip.destination}
					</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}
