<script lang="ts">
	import { resolve } from '$app/paths';
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import { getAccessContext } from '$lib/access';
	import { campaignRoleLabel } from '$lib/features/contacts/campaign-roles';
	import { projectMemberRoleLabel } from '$lib/features/projects/labels';
	import { formatTripDateRange } from '$lib/features/trips/format';
	import { tripAttendeeStatusLabel, tripAttendeeStatusVariant } from '$lib/features/trips/labels';
	import * as m from '$lib/i18n/messages';

	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import type { Id } from '$convex/_generated/dataModel';

	let { contactId }: { contactId: Id<'contacts'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();

	const canRead = $derived(access.can('contacts:read'));

	const campaignsResponse = useQuery(api.campaignMembers.queries.listCampaignsForContact, () =>
		auth.isAuthenticated && canRead ? { contactId } : 'skip'
	);
	const campaigns = $derived(campaignsResponse?.data ?? []);
	const campaignsLoading = $derived(campaignsResponse?.isLoading ?? false);

	const projectsResponse = useQuery(api.projectMembers.queries.listProjectsForContact, () =>
		auth.isAuthenticated && canRead ? { contactId } : 'skip'
	);
	const projects = $derived(projectsResponse?.data ?? []);
	const projectsLoading = $derived(projectsResponse?.isLoading ?? false);

	// Trips sit next to campaigns and records here rather than in a tab of their
	// own (PLAN-trips.md §11). Gated on projects:read, not contacts:read: trips
	// carry no capability of their own and `listTripsForContact` asks
	// projects:read per row against that row's OWN campaign (§9).
	const canReadTrips = $derived(access.can('projects:read'));

	const tripsResponse = useQuery(api.tripAttendees.queries.listTripsForContact, () =>
		auth.isAuthenticated && canReadTrips ? { contactId } : 'skip'
	);
	const trips = $derived(tripsResponse?.data ?? []);
	const tripsLoading = $derived(tripsResponse?.isLoading ?? false);

	/**
	 * The parenthetical in "Eman Hernandez (Coordinator)", read from this side.
	 * `role` is free text and often blank, so the flag answers for it — never a
	 * string match on the role, which an org spells however it likes.
	 */
	function attendeeRoleLabel(role: string | null, isLeader: boolean): string {
		if (role) return role;
		return isLeader ? m.tripDetail_leaderToggle() : m.trips_traveller();
	}

	function attributeLine(attributes: Record<string, string | number | boolean | null>): string {
		return Object.entries(attributes)
			.filter(([, value]) => value !== null && value !== '')
			.map(([key, value]) => `${key}: ${value}`)
			.join(' · ');
	}
</script>

<div class="flex flex-col gap-4">
	<Card.Root>
		<Card.Header>
			<Card.Title>{m.contactDetail_campaignMemberships()}</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if campaignsLoading}
				<div class="flex flex-col gap-2">
					<Skeleton class="h-10 w-full" />
					<Skeleton class="h-10 w-full" />
				</div>
			{:else if campaigns.length === 0}
				<EmptyState title={m.contactDetail_noCampaigns()} />
			{:else}
				<ul>
					{#each campaigns as membership (membership._id)}
						<li class="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
							<span class="min-w-0 truncate font-medium">{membership.campaign?.name ?? '—'}</span>
							<Badge variant="secondary">{campaignRoleLabel(membership.role)}</Badge>
						</li>
					{/each}
				</ul>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>{m.contactDetail_linkedProjects()}</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if projectsLoading}
				<div class="flex flex-col gap-2">
					<Skeleton class="h-10 w-full" />
					<Skeleton class="h-10 w-full" />
				</div>
			{:else if projects.length === 0}
				<EmptyState title={m.contactDetail_noProjects()} />
			{:else}
				<ul>
					{#each projects as link (link._id)}
						{@const attributes = attributeLine(link.attributes)}
						<li class="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
							<div class="min-w-0">
								{#if link.project}
									<a
										class="truncate font-medium hover:underline"
										href={resolve('/app/projects/[number]', { number: link.project.number })}
									>
										{link.project.number}
										{link.project.name}
									</a>
								{:else}
									<span class="font-medium">—</span>
								{/if}
								{#if attributes}
									<p class="text-muted-foreground truncate text-xs">{attributes}</p>
								{/if}
							</div>
							<Badge variant="secondary">{projectMemberRoleLabel(link.role)}</Badge>
						</li>
					{/each}
				</ul>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if canReadTrips}
		<Card.Root>
			<Card.Header>
				<Card.Title>{m.trips_title()}</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if tripsLoading}
					<div class="flex flex-col gap-2">
						<Skeleton class="h-10 w-full" />
						<Skeleton class="h-10 w-full" />
					</div>
				{:else if trips.length === 0}
					<EmptyState title={m.contactDetail_noTrips()} />
				{:else}
					<ul>
						{#each trips as attendance (attendance._id)}
							<li class="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
								<div class="min-w-0">
									{#if attendance.trip}
										<a
											class="truncate font-medium hover:underline"
											href={resolve('/app/trips/[id]', { id: attendance.tripId })}
										>
											{attendance.trip.name}
										</a>
										<p class="text-muted-foreground truncate text-xs">
											<span class="tabular-nums">
												{formatTripDateRange(attendance.trip.startOn, attendance.trip.endOn)}
											</span>
											· {attendance.trip.destination}
										</p>
									{:else}
										<span class="font-medium">—</span>
									{/if}
								</div>
								<div class="flex shrink-0 items-center gap-2">
									<Badge variant="secondary">
										{attendeeRoleLabel(attendance.role, attendance.isLeader)}
									</Badge>
									<!-- Their status on THIS journey, which is a fact about the
									journey and not about them (§2) — someone who declined December
									is still on the March roster. -->
									<Badge variant={tripAttendeeStatusVariant(attendance.status)}>
										{tripAttendeeStatusLabel(attendance.status)}
									</Badge>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
