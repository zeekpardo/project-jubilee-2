// ============================================================
// A traveller's own trips, in the portal
// ============================================================
// Same contract as `portal/queries.ts`: every handler takes `orgSlug`, resolves
// the PERSON from the session via `resolveSiteViewer`, and never accepts an id
// that names a person. A missing viewer is an empty result, never an error.
//
// `tripId` IS accepted, and is not an exception to that rule. A slug says which
// org's page is open; a tripId says which trip is open. Neither says who is
// looking, and neither widens anything on its own — every handler below
// re-derives the viewer's attendee row and returns nothing when there isn't
// one. Passing another trip's id gets you a trip you are not on, which is to
// say nothing at all.
//
// What may be returned is decided in `model/portal.ts` under "TRIPS, as a
// traveller sees their own", including the deliberate narrowing that lets a
// roster show colleagues' names. This file joins and bounds; it does not
// project.
// ============================================================

import { ConvexError, v } from 'convex/values';
import { mutation, query } from '../_generated/server';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { resolveSiteViewer } from '../model/identity';
import type { PortalViewer } from '../model/identity';
import {
	toPortalTripCompanion,
	toPortalTripSegment,
	toPortalTripSummary
} from '../model/portal';

/**
 * The viewer's own attendee row on this trip, or null.
 *
 * THE ONE GATE. Every read and every write below goes through it, so
 * "membership decides what you see" is enforced in a single place rather than
 * re-derived per handler. Returns null rather than throwing on a read path:
 * being removed from a trip while the page is open should empty the surface.
 */
async function ownAttendance(
	ctx: QueryCtx | MutationCtx,
	viewer: PortalViewer,
	tripId: Id<'trips'>
): Promise<{ trip: Doc<'trips'>; attendee: Doc<'tripAttendees'> } | null> {
	const trip = await ctx.db.get('trips', tripId);
	if (!trip || trip.orgId !== viewer.orgId) return null;

	const attendee = await ctx.db
		.query('tripAttendees')
		.withIndex('by_tripId_and_contactId', (q) =>
			q.eq('tripId', tripId).eq('contactId', viewer.contact._id)
		)
		.unique();
	if (!attendee || attendee.orgId !== viewer.orgId) return null;

	return { trip, attendee };
}

/** Every trip this person is travelling on, soonest first. */
export const listPortalTrips = query({
	args: { orgSlug: v.string() },
	handler: async (ctx, args) => {
		const viewer = await resolveSiteViewer(ctx, args.orgSlug);
		if (!viewer) return [];

		// By contact, so the read is bounded by how many trips this ONE person is
		// on — never by how many the org runs.
		const attendances = await ctx.db
			.query('tripAttendees')
			.withIndex('by_contactId', (q) => q.eq('contactId', viewer.contact._id))
			.collect();

		const rows = [];
		for (const attendee of attendances) {
			if (attendee.orgId !== viewer.orgId) continue;
			const trip = await ctx.db.get('trips', attendee.tripId);
			if (!trip || trip.orgId !== viewer.orgId) continue;
			rows.push(toPortalTripSummary(trip, attendee));
		}

		return rows.sort((a, b) => a.startOn.localeCompare(b.startOn));
	}
});

/**
 * One trip, as its traveller reads it: the dates, the itinerary they are
 * actually flying, and who else is going.
 *
 * NO linked records and NO budget — see the header in `model/portal.ts` for
 * why those two in particular.
 */
export const getPortalTrip = query({
	args: { orgSlug: v.string(), tripId: v.id('trips') },
	handler: async (ctx, args) => {
		const viewer = await resolveSiteViewer(ctx, args.orgSlug);
		if (!viewer) return null;

		const own = await ownAttendance(ctx, viewer, args.tripId);
		if (!own) return null;

		const segments = await ctx.db
			.query('tripSegments')
			.withIndex('by_tripId_and_direction_and_order', (q) => q.eq('tripId', own.trip._id))
			.collect();

		// The group itinerary, plus this traveller's own legs. Another person's
		// personal legs are not theirs to read.
		const mine = segments.filter(
			(segment) => segment.attendeeId === undefined || segment.attendeeId === own.attendee._id
		);

		const roster = await ctx.db
			.query('tripAttendees')
			.withIndex('by_tripId', (q) => q.eq('tripId', own.trip._id))
			.collect();

		const companions = [];
		for (const attendee of roster) {
			if (attendee.orgId !== viewer.orgId) continue;
			// Someone who said no is not on the trip, and their decline is their
			// own business rather than roster information.
			if (attendee.status === 'declined' || attendee.status === 'cancelled') continue;
			const contact = await ctx.db.get('contacts', attendee.contactId);
			const companion = toPortalTripCompanion(contact, attendee);
			if (companion) companions.push(companion);
		}

		return {
			trip: toPortalTripSummary(own.trip, own.attendee),
			segments: mine
				.map((segment) => toPortalTripSegment(segment, own.attendee._id))
				.sort(
					(a, b) => a.direction.localeCompare(b.direction) || a.order - b.order
				),
			// Leaders first, then everyone else, both alphabetical.
			companions: companions.sort(
				(a, b) => Number(b.isLeader) - Number(a.isLeader) || a.name.localeCompare(b.name)
			)
		};
	}
});

// ============================================================
// Writes — a traveller's OWN legs, and nothing else
// ============================================================
// The only mutations in the portal's surface. Each one re-resolves the viewer,
// re-derives their attendee row, and stamps `attendeeId` from that row rather
// than from an argument. A caller therefore cannot write a leg onto another
// traveller, nor touch the GROUP itinerary — a segment with no `attendeeId` is
// staff logistics, and `requireOwnSegment` refuses it.
// ============================================================

const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * A local wall clock, with no zone suffix. A `Z`-suffixed value is the exact
 * bug the storage choice exists to prevent — see PLAN-trips.md §5 — so it is
 * refused here rather than stored and misrendered later.
 */
function assertWallClock(label: string, value: string): void {
	if (!WALL_CLOCK.test(value)) {
		throw new ConvexError(`${label} must look like 2026-12-01T23:55, with no time zone`);
	}
}

function normalizeAirport(value: string | undefined): string | undefined {
	const trimmed = value?.trim().toUpperCase();
	if (!trimmed) return undefined;
	if (!/^[A-Z]{3}$/.test(trimmed)) throw new ConvexError('An airport code is three letters');
	return trimmed;
}

async function requireOwnAttendance(
	ctx: MutationCtx,
	orgSlug: string,
	tripId: Id<'trips'>
): Promise<{ viewer: PortalViewer; trip: Doc<'trips'>; attendee: Doc<'tripAttendees'> }> {
	const viewer = await resolveSiteViewer(ctx, orgSlug);
	if (!viewer) throw new ConvexError('Not signed in');
	const own = await ownAttendance(ctx, viewer, tripId);
	if (!own) throw new ConvexError('Trip not found');
	return { viewer, ...own };
}

/** A segment that exists, is on this trip, and belongs to THIS traveller. */
async function requireOwnSegment(
	ctx: MutationCtx,
	segmentId: Id<'tripSegments'>,
	attendee: Doc<'tripAttendees'>
): Promise<Doc<'tripSegments'>> {
	const segment = await ctx.db.get('tripSegments', segmentId);
	if (!segment || segment.orgId !== attendee.orgId || segment.tripId !== attendee.tripId) {
		throw new ConvexError('Flight not found');
	}
	// An absent attendeeId is the GROUP itinerary — staff's, not a traveller's.
	if (segment.attendeeId !== attendee._id) throw new ConvexError('Flight not found');
	return segment;
}

export const addPortalTripSegment = mutation({
	args: {
		orgSlug: v.string(),
		tripId: v.id('trips'),
		direction: v.union(v.literal('outbound'), v.literal('return')),
		airline: v.string(),
		flightNumber: v.string(),
		departureAirport: v.optional(v.string()),
		arrivalAirport: v.optional(v.string()),
		departureAt: v.string(),
		arrivalAt: v.string(),
		departureTimeZone: v.optional(v.string()),
		arrivalTimeZone: v.optional(v.string()),
		confirmationCode: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { attendee } = await requireOwnAttendance(ctx, args.orgSlug, args.tripId);

		assertWallClock('Departure', args.departureAt);
		assertWallClock('Arrival', args.arrivalAt);
		const airline = args.airline.trim();
		const flightNumber = args.flightNumber.trim().toUpperCase();
		if (!airline || !flightNumber) throw new ConvexError('An airline and flight number are needed');

		// Appended after this traveller's existing legs in the same direction, so
		// a connection entered second lands after the one entered first.
		const existing = await ctx.db
			.query('tripSegments')
			.withIndex('by_attendeeId', (q) => q.eq('attendeeId', attendee._id))
			.collect();
		const order = existing
			.filter((segment) => segment.direction === args.direction)
			.reduce((max, segment) => Math.max(max, segment.order + 1), 0);

		return await ctx.db.insert('tripSegments', {
			orgId: attendee.orgId,
			tripId: attendee.tripId,
			// From the resolved row, NEVER from an argument.
			attendeeId: attendee._id,
			direction: args.direction,
			order,
			airline,
			flightNumber,
			departureAirport: normalizeAirport(args.departureAirport),
			arrivalAirport: normalizeAirport(args.arrivalAirport),
			departureAt: args.departureAt,
			arrivalAt: args.arrivalAt,
			departureTimeZone: args.departureTimeZone?.trim() || undefined,
			arrivalTimeZone: args.arrivalTimeZone?.trim() || undefined,
			confirmationCode: args.confirmationCode?.trim() || undefined
		});
	}
});

export const updatePortalTripSegment = mutation({
	args: {
		orgSlug: v.string(),
		tripId: v.id('trips'),
		segmentId: v.id('tripSegments'),
		airline: v.optional(v.string()),
		flightNumber: v.optional(v.string()),
		departureAirport: v.optional(v.union(v.string(), v.null())),
		arrivalAirport: v.optional(v.union(v.string(), v.null())),
		departureAt: v.optional(v.string()),
		arrivalAt: v.optional(v.string()),
		departureTimeZone: v.optional(v.union(v.string(), v.null())),
		arrivalTimeZone: v.optional(v.union(v.string(), v.null())),
		confirmationCode: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		const { attendee } = await requireOwnAttendance(ctx, args.orgSlug, args.tripId);
		await requireOwnSegment(ctx, args.segmentId, attendee);

		const patch: Partial<Doc<'tripSegments'>> = {};
		if (args.airline !== undefined) {
			const airline = args.airline.trim();
			if (!airline) throw new ConvexError('An airline is needed');
			patch.airline = airline;
		}
		if (args.flightNumber !== undefined) {
			const flightNumber = args.flightNumber.trim().toUpperCase();
			if (!flightNumber) throw new ConvexError('A flight number is needed');
			patch.flightNumber = flightNumber;
		}
		if (args.departureAt !== undefined) {
			assertWallClock('Departure', args.departureAt);
			patch.departureAt = args.departureAt;
		}
		if (args.arrivalAt !== undefined) {
			assertWallClock('Arrival', args.arrivalAt);
			patch.arrivalAt = args.arrivalAt;
		}
		if (args.departureAirport !== undefined) {
			patch.departureAirport = normalizeAirport(args.departureAirport ?? undefined);
		}
		if (args.arrivalAirport !== undefined) {
			patch.arrivalAirport = normalizeAirport(args.arrivalAirport ?? undefined);
		}
		if (args.departureTimeZone !== undefined) {
			patch.departureTimeZone = args.departureTimeZone?.trim() || undefined;
		}
		if (args.arrivalTimeZone !== undefined) {
			patch.arrivalTimeZone = args.arrivalTimeZone?.trim() || undefined;
		}
		if (args.confirmationCode !== undefined) {
			patch.confirmationCode = args.confirmationCode?.trim() || undefined;
		}

		await ctx.db.patch('tripSegments', args.segmentId, patch);
		return args.segmentId;
	}
});

export const removePortalTripSegment = mutation({
	args: { orgSlug: v.string(), tripId: v.id('trips'), segmentId: v.id('tripSegments') },
	handler: async (ctx, args) => {
		const { attendee } = await requireOwnAttendance(ctx, args.orgSlug, args.tripId);
		await requireOwnSegment(ctx, args.segmentId, attendee);
		await ctx.db.delete('tripSegments', args.segmentId);
		return null;
	}
});
