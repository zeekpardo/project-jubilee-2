<script lang="ts">
	// A traveller's own view of one trip.
	//
	// Deliberately NOT the staff trip page with fields hidden. It reads from
	// `portal/trips.ts`, whose projection decides what a traveller may see —
	// notably no linked records and no budget. See the TRIPS header in
	// `model/portal.ts` for why those two in particular.
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';
	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';
	import { formatTripDateRange } from '$lib/features/trips/format';
	import { formatWallClockDateTime, arrivesNextDay } from '$lib/domain/trip-itinerary';

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	// Empty rather than undefined — see the list page. A falsy slug skips the
	// query, and a mutation sent with '' resolves to no viewer and is refused.
	const orgSlug = $derived(page.params.orgSlug ?? '');
	const tripId = $derived((page.params.tripId ?? '') as Id<'trips'>);

	const response = useQuery(api.portal.trips.getPortalTrip, () =>
		auth.isAuthenticated && orgSlug && tripId ? { orgSlug, tripId } : 'skip'
	);
	const data = $derived(response.data);

	const outbound = $derived((data?.segments ?? []).filter((s) => s.direction === 'outbound'));
	const inbound = $derived((data?.segments ?? []).filter((s) => s.direction === 'return'));

	// Adding a leg. Kept to the fields a traveller reads off a ticket; the zone
	// is optional because being asked for IANA at midnight is not reasonable,
	// and every duration degrades rather than guesses when it is absent.
	let showForm = $state(false);
	let direction = $state<'outbound' | 'return'>('outbound');
	let airline = $state('');
	let flightNumber = $state('');
	let departureAirport = $state('');
	let arrivalAirport = $state('');
	let departureAt = $state('');
	let arrivalAt = $state('');
	let confirmationCode = $state('');
	let isSaving = $state(false);

	const canSubmit = $derived(
		airline.trim() !== '' &&
			flightNumber.trim() !== '' &&
			departureAt.trim() !== '' &&
			arrivalAt.trim() !== '' &&
			!isSaving
	);

	function resetForm(): void {
		airline = '';
		flightNumber = '';
		departureAirport = '';
		arrivalAirport = '';
		departureAt = '';
		arrivalAt = '';
		confirmationCode = '';
	}

	function reportError(error: unknown): void {
		toast.error(
			error instanceof ConvexError
				? String(error.data)
				: error instanceof Error
					? error.message
					: m.state_saveFailed()
		);
	}

	async function addSegment(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!canSubmit) return;
		isSaving = true;
		try {
			await client.mutation(api.portal.trips.addPortalTripSegment, {
				orgSlug,
				tripId,
				direction,
				airline: airline.trim(),
				flightNumber: flightNumber.trim(),
				departureAirport: departureAirport.trim() || undefined,
				arrivalAirport: arrivalAirport.trim() || undefined,
				departureAt: departureAt.trim(),
				arrivalAt: arrivalAt.trim(),
				confirmationCode: confirmationCode.trim() || undefined
			});
			toast.success(m.state_saved());
			resetForm();
			showForm = false;
		} catch (error: unknown) {
			reportError(error);
		} finally {
			isSaving = false;
		}
	}

	async function removeSegment(segmentId: string): Promise<void> {
		try {
			await client.mutation(api.portal.trips.removePortalTripSegment, {
				orgSlug,
				tripId,
				segmentId: segmentId as Id<'tripSegments'>
			});
			toast.success(m.state_deleted());
		} catch (error: unknown) {
			reportError(error);
		}
	}
</script>

<svelte:head>
	<title>{data?.trip.name ?? m.portal_tripsTitle()}</title>
</svelte:head>

<a
	href={resolve('/(me)/[orgSlug]/me/trips', { orgSlug })}
	class="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
>
	<ChevronLeftIcon class="size-4" />
	{m.portal_tripsTitle()}
</a>

{#if !response.isLoading && !data}
	<EmptyState title={m.portal_tripNotFound()} description={m.portal_tripNotFoundBody()} />
{:else if data}
	<header class="mt-4">
		<h1 class="ps-serif text-foreground text-3xl leading-tight">{data.trip.name}</h1>
		<p class="text-muted-foreground mt-2 text-sm">
			{formatTripDateRange(data.trip.startOn, data.trip.endOn)} · {data.trip.destination}
		</p>
	</header>

	<!-- Itinerary: the group's legs plus this traveller's own. Times render as
	     the wall clock stored, which is what the boarding pass says. -->
	<section class="mt-8">
		<h2 class="text-foreground text-lg font-medium">{m.tripDetail_itinerary()}</h2>
		{#if data.segments.length === 0}
			<p class="text-muted-foreground mt-2 text-sm">{m.portal_tripNoFlights()}</p>
		{:else}
			{#each [{ label: m.tripDetail_outbound(), legs: outbound }, { label: m.tripDetail_return(), legs: inbound }] as group (group.label)}
				{#if group.legs.length > 0}
					<h3 class="text-muted-foreground mt-4 text-xs font-semibold tracking-wide uppercase">
						{group.label}
					</h3>
					<ul class="mt-2 flex flex-col gap-2">
						{#each group.legs as leg (leg.id)}
							<li class="border-border flex flex-wrap items-center gap-3 rounded-lg border p-3">
								<span class="font-medium">{leg.airline} {leg.flightNumber}</span>
								{#if leg.departureAirport && leg.arrivalAirport}
									<span class="text-muted-foreground text-sm">
										{leg.departureAirport} → {leg.arrivalAirport}
									</span>
								{/if}
								<span class="text-muted-foreground text-sm">
									{formatWallClockDateTime(leg.departureAt)} – {formatWallClockDateTime(leg.arrivalAt)}
									{#if arrivesNextDay(leg)}
										<Badge variant="outline" class="ml-1">+1</Badge>
									{/if}
								</span>
								{#if leg.confirmationCode}
									<span class="text-muted-foreground font-mono text-xs">{leg.confirmationCode}</span>
								{/if}
								{#if leg.isOwn}
									<Badge variant="secondary">{m.portal_tripMyFlight()}</Badge>
									<Button
										variant="ghost"
										size="icon"
										class="ms-auto"
										aria-label={m.action_delete()}
										title={m.action_delete()}
										onclick={() => removeSegment(leg.id)}
									>
										<Trash2Icon />
									</Button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			{/each}
		{/if}

		{#if !showForm}
			<Button variant="outline" size="sm" class="mt-4" onclick={() => (showForm = true)}>
				{m.portal_tripAddFlight()}
			</Button>
		{:else}
			<form class="border-border mt-4 flex flex-col gap-3 rounded-lg border p-4" onsubmit={addSegment}>
				<p class="text-muted-foreground text-xs">{m.portal_tripAddFlightHelp()}</p>
				<div class="flex flex-wrap gap-2">
					<Button
						type="button"
						variant={direction === 'outbound' ? 'secondary' : 'outline'}
						size="sm"
						onclick={() => (direction = 'outbound')}
					>
						{m.tripDetail_outbound()}
					</Button>
					<Button
						type="button"
						variant={direction === 'return' ? 'secondary' : 'outline'}
						size="sm"
						onclick={() => (direction = 'return')}
					>
						{m.tripDetail_return()}
					</Button>
				</div>
				<div class="grid gap-3 sm:grid-cols-2">
					<div class="flex flex-col gap-1">
						<Label for="airline">{m.tripDetail_airline()}</Label>
						<Input id="airline" bind:value={airline} required />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="flightNumber">{m.tripDetail_flightNumber()}</Label>
						<Input id="flightNumber" bind:value={flightNumber} required />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="from">{m.tripDetail_departureAirport()}</Label>
						<Input id="from" bind:value={departureAirport} placeholder="DFW" maxlength={3} />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="to">{m.tripDetail_arrivalAirport()}</Label>
						<Input id="to" bind:value={arrivalAirport} placeholder="DOH" maxlength={3} />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="dep">{m.tripDetail_departureAt()}</Label>
						<Input id="dep" type="datetime-local" bind:value={departureAt} required />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="arr">{m.tripDetail_arrivalAt()}</Label>
						<Input id="arr" type="datetime-local" bind:value={arrivalAt} required />
					</div>
					<div class="flex flex-col gap-1 sm:col-span-2">
						<Label for="conf">{m.tripDetail_confirmationCode()}</Label>
						<Input id="conf" bind:value={confirmationCode} />
					</div>
				</div>
				<div class="flex justify-end gap-2">
					<Button type="button" variant="outline" onclick={() => (showForm = false)}>
						{m.action_cancel()}
					</Button>
					<Button type="submit" loading={isSaving} disabled={!canSubmit}>{m.action_save()}</Button>
				</div>
			</form>
		{/if}
	</section>

	<!-- Names and roles only. See the TRIPS header in model/portal.ts. -->
	<section class="mt-8">
		<h2 class="text-foreground text-lg font-medium">{m.portal_tripCompanions()}</h2>
		<ul class="mt-2 flex flex-col gap-1">
			{#each data.companions as person (person.name)}
				<li class="flex items-center gap-2 text-sm">
					<span>{person.name}</span>
					{#if person.isLeader}
						<Badge variant="secondary">{m.tripDetail_leaderToggle()}</Badge>
					{:else if person.role}
						<Badge variant="outline">{person.role}</Badge>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
