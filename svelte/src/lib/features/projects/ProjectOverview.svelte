<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import type { Doc } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import { formatTripDateRange } from '$lib/features/trips/format';
	import { tripStatusLabel, tripStatusVariant } from '$lib/features/trips/labels';

	let { project }: { project: Doc<'projects'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();

	// Which trips visited this record, and when — two lines, not a tab
	// (PLAN-trips.md §11). Most records are never visited, so the block renders
	// nothing at all rather than an empty card, the same way the details card
	// below disappears when there is nothing to put in it.
	const tripsResponse = useQuery(api.trips.queries.listTripsForProject, () =>
		auth.isAuthenticated ? { projectId: project._id } : 'skip'
	);
	// flatMap rather than filter so the null trip is gone from the TYPE too: the
	// link outlives nothing here, but the query returns `trip: null` for a row
	// whose trip was deleted mid-subscription and the template must not have to
	// re-ask.
	const visits = $derived(
		(tripsResponse.data ?? []).flatMap((link) =>
			link.trip ? [{ _id: link._id, note: link.note ?? null, trip: link.trip }] : []
		)
	);

	const details = $derived(
		[
			{ key: 'publicName', label: m.projects_publicName(), value: project.publicName, href: null },
			{
				key: 'videoUrl',
				label: m.projects_videoUrl(),
				value: project.videoUrl,
				href: project.videoUrl
			}
		].filter((detail) => Boolean(detail.value))
	);
</script>

<!-- The only links here are admin-entered external URLs, not app routes. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
<div class="flex flex-col gap-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>{m.projects_story()}</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if project.story}
				<p class="text-sm leading-relaxed whitespace-pre-line">{project.story}</p>
			{:else}
				<p class="text-muted-foreground text-sm">{m.state_empty()}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if details.length > 0}
		<Card.Root>
			<Card.Header>
				<Card.Title>{m.projects_editDetails()}</Card.Title>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				{#if details.length > 0}
					<dl class="grid gap-4 sm:grid-cols-2">
						{#each details as detail (detail.key)}
							<div class="flex flex-col gap-1">
								<dt class="text-muted-foreground text-xs">{detail.label}</dt>
								<dd class="text-sm break-words">
									{#if detail.href}
										<a
											class="text-primary hover:underline"
											href={detail.href}
											target="_blank"
											rel="noopener noreferrer"
										>
											{detail.value}
										</a>
									{:else}
										{detail.value}
									{/if}
								</dd>
							</div>
						{/each}
					</dl>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if visits.length > 0}
		<Card.Root>
			<Card.Header>
				<Card.Title>{m.trips_title()}</Card.Title>
				<Card.Description>{m.trips_visitedBy()}</Card.Description>
			</Card.Header>
			<Card.Content>
				<ul class="flex flex-col gap-3">
					{#each visits as visit (visit._id)}
						<li class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
							<a
								class="font-medium hover:underline"
								href={resolve('/app/trips/[id]', { id: visit.trip._id })}
							>
								{visit.trip.name}
							</a>
							<span class="text-muted-foreground tabular-nums">
								{formatTripDateRange(visit.trip.startOn, visit.trip.endOn)}
							</span>
							<span class="text-muted-foreground">{visit.trip.destination}</span>
							<Badge variant={tripStatusVariant(visit.trip.status)}>
								{tripStatusLabel(visit.trip.status)}
							</Badge>
							{#if visit.note}
								<span class="text-muted-foreground text-xs">{visit.note}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
