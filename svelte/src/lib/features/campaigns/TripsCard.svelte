<script lang="ts">
	// Campaign detail's trip block — count, next trip, and the way in to
	// /app/trips (PLAN-trips.md §11).
	//
	// Mounted ONLY when `campaign.tripsEnabled` is true. The column is optional and
	// absent means false (§2): most campaigns never run a trip, and this card must
	// not appear on them at all. The gate lives on the page rather than here so
	// that "absent = off" is decided in one place.
	//
	// No read gate of its own: `getCampaign` already returns null without
	// `projects:read` on this campaign, so the page cannot render with a campaign
	// the viewer may not read trips for.

	// Primitives
	import { resolve } from '$app/paths';
	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import PlaneIcon from '@lucide/svelte/icons/plane';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { formatTripDateRange } from '$lib/features/trips/format';
	import { tripStatusLabel, tripStatusVariant } from '$lib/features/trips/labels';
	import * as m from '$lib/i18n/messages';
	import type { Campaign } from './types';

	let { campaign }: { campaign: Campaign } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const active = getActiveCampaignContext();

	const tripsResponse = useQuery(api.trips.queries.listTrips, () =>
		auth.isAuthenticated ? { campaignId: campaign._id } : 'skip'
	);
	// Already soonest-first: `listTrips` reads by_campaignId_and_startOn and the
	// list is never re-sorted client-side.
	const trips = $derived(tripsResponse.data ?? []);

	/**
	 * The viewer's own calendar day as YYYY-MM-DD, built from the runtime's local
	 * date parts rather than `toISOString()`, which would report tomorrow east of
	 * Greenwich and yesterday west of it for part of every day.
	 *
	 * This is `new Date()` for NOW, never `new Date(storedString)` — a trip's
	 * startOn/endOn are calendar days and are only ever compared as strings, which
	 * is exactly what ISO ordering makes safe.
	 */
	function todayIso(): string {
		const now = new Date();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		return `${now.getFullYear()}-${month}-${day}`;
	}

	// "Next" is the soonest trip that has not finished and has not been called
	// off. A trip running right now is still the next one a coordinator cares
	// about, so the comparison is against endOn rather than startOn.
	const nextTrip = $derived.by(() => {
		const today = todayIso();
		return trips.find((trip) => trip.status !== 'cancelled' && trip.endOn >= today) ?? null;
	});
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.trips_title()}</Card.Title>
		<Card.Description>{m.trips_subtitle()}</Card.Description>
		<Card.Action>
			<!-- /app/trips lists the ACTIVE campaign's trips, so the switch comes
			with the click. Without it, a link from campaign A's settings would land
			on whichever campaign the sidebar was last left on. -->
			<Button
				variant="outline"
				size="sm"
				href={resolve('/app/trips')}
				onclick={() => active.select(campaign._id)}
			>
				{m.trips_viewAll()}
			</Button>
		</Card.Action>
	</Card.Header>
	<Card.Content>
		{#if tripsResponse.isLoading}
			<div class="flex flex-col gap-3">
				<Skeleton class="h-8 w-40" />
				<Skeleton class="h-8 w-64" />
			</div>
		{:else if trips.length === 0}
			<EmptyState
				size="sm"
				variant="plain"
				title={m.trips_empty()}
				description={m.trips_emptyBody()}
			>
				{#snippet icon()}
					<PlaneIcon />
				{/snippet}
			</EmptyState>
		{:else}
			<dl class="grid gap-6 sm:grid-cols-2">
				<div class="flex flex-col gap-1">
					<dt class="text-muted-foreground text-xs">{m.trips_total()}</dt>
					<dd class="text-2xl font-semibold tabular-nums">{trips.length}</dd>
				</div>
				<div class="flex flex-col gap-1">
					<dt class="text-muted-foreground text-xs">{m.trips_next()}</dt>
					<dd class="text-sm">
						{#if nextTrip}
							<a
								class="font-medium hover:underline"
								href={resolve('/app/trips/[id]', { id: nextTrip._id })}
							>
								{nextTrip.name}
							</a>
							<div class="text-muted-foreground mt-1 flex flex-wrap items-center gap-2">
								<span class="tabular-nums">
									{formatTripDateRange(nextTrip.startOn, nextTrip.endOn)}
								</span>
								<span>{nextTrip.destination}</span>
								<Badge variant={tripStatusVariant(nextTrip.status)}>
									{tripStatusLabel(nextTrip.status)}
								</Badge>
							</div>
						{:else}
							<span class="text-muted-foreground">{m.trips_noneUpcoming()}</span>
						{/if}
					</dd>
				</div>
			</dl>
		{/if}
	</Card.Content>
</Card.Root>
