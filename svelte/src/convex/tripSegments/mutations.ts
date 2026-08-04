// ============================================================
// Writing flight legs
// ============================================================
// One row is one LEG, not one flight: nobody flies to Pakistan on a single
// hop, it is DFW → DOH → ISB and back. Legs are ordered within a direction.
//
// GROUP vs PER-PERSON. `attendeeId` absent means the group itinerary; present
// means that one traveller's own leg — someone who joins from another city, or
// stays a week longer and flies home alone. One table, because every column is
// identical and the trip page renders them in one list. Per-person legs are in
// v1 deliberately (§5): the coordinator building the airport pickup list sorts
// legs by arrival time, and `notes: "Maria comes in Tuesday"` does not sort,
// does not group by airport, and leaves somebody at Islamabad International.
//
// THE TIMES. `departureAt` / `arrivalAt` are LOCAL WALL CLOCK at the airport,
// 'YYYY-MM-DDTHH:mm' with NO zone suffix — what the boarding pass says. That is
// checked here, at the write, because every reader renders the string verbatim
// and a value with a 'Z' on the end would be re-interpreted in whichever zone
// happened to parse it. The IANA zone columns are the other half of the fact
// and stay optional: a coordinator typing a ticket at midnight is not blocked
// on them, and every consumer degrades to displaying the wall clock and
// declining to compute.
//
// ACCESS (§9). No trips capability: every write is `projects:write` scoped to
// the trip's own campaign, gated twice because the campaign is only knowable
// once the row is read.
// ============================================================

import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireCapability } from '../model/access';

export const tripSegmentDirectionValidator = v.union(v.literal('outbound'), v.literal('return'));

/** `null` clears the column; an absent argument leaves it alone. */
const clearableString = v.optional(v.union(v.string(), v.null()));

/**
 * Local wall clock, no zone. The shape is checked and the calendar is not —
 * rejecting 2026-02-31 would need a date library in a write path to buy very
 * little, while a wrong-but-well-formed value still renders and still sorts.
 * What must not get in is a value of a DIFFERENT SHAPE: '2026-03-14T23:55Z' or
 * an epoch number would each be silently reinterpreted downstream, which is the
 * exact bug this column's storage choice exists to prevent.
 */
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function assertWallClock(field: string, value: string): void {
	if (!WALL_CLOCK.test(value)) {
		throw new ConvexError(
			`A ${field} is the airport's local time and must look like 2026-03-14T23:55, not "${value}" — no timezone suffix, because the zone goes in its own column.`
		);
	}
}

/**
 * IATA, uppercased on write so 'dfw' and 'DFW' are one airport to every reader
 * that groups an arrivals list by code. Absent stays absent — a leg can be
 * entered before the routing is known.
 */
function normalizeAirport(code: string | undefined | null): string | undefined {
	const trimmed = code?.trim().toUpperCase();
	if (!trimmed) return undefined;
	if (!/^[A-Z]{3}$/.test(trimmed)) {
		throw new ConvexError(`An airport code is three letters, like DFW — not "${code}"`);
	}
	return trimmed;
}

async function requireTrip(
	ctx: MutationCtx,
	orgId: string,
	tripId: Id<'trips'>
): Promise<Doc<'trips'>> {
	const trip = await ctx.db.get('trips', tripId);
	if (!trip || trip.orgId !== orgId) {
		throw new ConvexError('Trip not found');
	}
	return trip;
}

/**
 * A per-person leg may only name an attendee of ITS OWN trip. Without this a
 * leg could be hung off somebody on a different journey and would render on
 * two itineraries, one of them wrong.
 */
async function requireAttendeeOnTrip(
	ctx: MutationCtx,
	orgId: string,
	tripId: Id<'trips'>,
	attendeeId: Id<'tripAttendees'>
): Promise<Doc<'tripAttendees'>> {
	const attendee = await ctx.db.get('tripAttendees', attendeeId);
	if (!attendee || attendee.orgId !== orgId) {
		throw new ConvexError('Trip attendee not found');
	}
	if (attendee.tripId !== tripId) {
		throw new ConvexError('That traveller is on a different trip');
	}
	return attendee;
}

async function requireSegment(
	ctx: MutationCtx,
	segmentId: Id<'tripSegments'>
): Promise<{ segment: Doc<'tripSegments'>; trip: Doc<'trips'>; orgId: string }> {
	const { orgId } = await requireCapability(ctx, 'projects:write');
	const segment = await ctx.db.get('tripSegments', segmentId);
	if (!segment || segment.orgId !== orgId) {
		throw new ConvexError('Flight leg not found');
	}
	const trip = await requireTrip(ctx, orgId, segment.tripId);
	await requireCapability(ctx, 'projects:write', trip.campaignId);
	return { segment, trip, orgId };
}

/**
 * Where a new leg sits: after everything already in the same direction of the
 * same itinerary. The group set and each traveller's own set are ordered
 * independently — a traveller's second leg is their 1, not the group's next
 * number — so the scope of the count is (tripId, direction, attendeeId).
 */
async function nextSegmentOrder(
	ctx: MutationCtx,
	tripId: Id<'trips'>,
	direction: 'outbound' | 'return',
	attendeeId: Id<'tripAttendees'> | undefined
): Promise<number> {
	const existing = await ctx.db
		.query('tripSegments')
		.withIndex('by_tripId_and_direction_and_order', (q) =>
			q.eq('tripId', tripId).eq('direction', direction)
		)
		.collect();
	return (
		existing
			.filter((leg) => leg.attendeeId === attendeeId)
			.reduce((highest, leg) => Math.max(highest, leg.order), -1) + 1
	);
}

export const addTripSegment = mutation({
	args: {
		tripId: v.id('trips'),
		// Absent = the group itinerary. Present = this one person's own leg.
		attendeeId: v.optional(v.id('tripAttendees')),
		direction: tripSegmentDirectionValidator,
		// Absent appends to the end of that direction, which is how a coordinator
		// types an itinerary: in the order they read it off the ticket.
		order: v.optional(v.number()),
		airline: v.string(),
		flightNumber: v.string(),
		departureAirport: v.optional(v.string()),
		arrivalAirport: v.optional(v.string()),
		departureAt: v.string(),
		arrivalAt: v.string(),
		departureTimeZone: v.optional(v.string()),
		arrivalTimeZone: v.optional(v.string()),
		confirmationCode: v.optional(v.string()),
		notes: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const trip = await requireTrip(ctx, orgId, args.tripId);
		await requireCapability(ctx, 'projects:write', trip.campaignId);

		if (args.attendeeId) {
			await requireAttendeeOnTrip(ctx, orgId, trip._id, args.attendeeId);
		}

		const airline = args.airline.trim();
		const flightNumber = args.flightNumber.trim();
		if (!airline) throw new ConvexError('A flight leg needs an airline');
		if (!flightNumber) throw new ConvexError('A flight leg needs a flight number');
		assertWallClock('departure time', args.departureAt);
		assertWallClock('arrival time', args.arrivalAt);

		return await ctx.db.insert('tripSegments', {
			orgId,
			tripId: trip._id,
			attendeeId: args.attendeeId,
			direction: args.direction,
			order: args.order ?? (await nextSegmentOrder(ctx, trip._id, args.direction, args.attendeeId)),
			airline,
			flightNumber: flightNumber.toUpperCase(),
			departureAirport: normalizeAirport(args.departureAirport),
			arrivalAirport: normalizeAirport(args.arrivalAirport),
			departureAt: args.departureAt,
			arrivalAt: args.arrivalAt,
			departureTimeZone: args.departureTimeZone?.trim() || undefined,
			arrivalTimeZone: args.arrivalTimeZone?.trim() || undefined,
			confirmationCode: args.confirmationCode?.trim() || undefined,
			notes: args.notes?.trim() || undefined
		});
	}
});

/**
 * Edit one leg. `tripId` and `attendeeId` are deliberately absent: moving a leg
 * to another trip, or from the group set onto one traveller, changes which
 * itinerary it belongs to rather than what it says. Delete and re-add, or use
 * `copyGroupSegmentsToAttendee` for the case that actually comes up.
 */
export const updateTripSegment = mutation({
	args: {
		segmentId: v.id('tripSegments'),
		direction: v.optional(tripSegmentDirectionValidator),
		order: v.optional(v.number()),
		airline: v.optional(v.string()),
		flightNumber: v.optional(v.string()),
		departureAirport: clearableString,
		arrivalAirport: clearableString,
		departureAt: v.optional(v.string()),
		arrivalAt: v.optional(v.string()),
		departureTimeZone: clearableString,
		arrivalTimeZone: clearableString,
		confirmationCode: clearableString,
		notes: clearableString
	},
	handler: async (ctx, args) => {
		const { segment } = await requireSegment(ctx, args.segmentId);

		const patch: Partial<Omit<Doc<'tripSegments'>, '_id' | '_creationTime' | 'orgId'>> = {};

		if (args.direction !== undefined) patch.direction = args.direction;
		if (args.order !== undefined) patch.order = args.order;

		if (args.airline !== undefined) {
			const airline = args.airline.trim();
			if (!airline) throw new ConvexError('A flight leg needs an airline');
			patch.airline = airline;
		}
		if (args.flightNumber !== undefined) {
			const flightNumber = args.flightNumber.trim();
			if (!flightNumber) throw new ConvexError('A flight leg needs a flight number');
			patch.flightNumber = flightNumber.toUpperCase();
		}

		if (args.departureAt !== undefined) {
			assertWallClock('departure time', args.departureAt);
			patch.departureAt = args.departureAt;
		}
		if (args.arrivalAt !== undefined) {
			assertWallClock('arrival time', args.arrivalAt);
			patch.arrivalAt = args.arrivalAt;
		}

		// Storing `undefined` drops the column, which is what `null` asks for here.
		if (args.departureAirport !== undefined) {
			patch.departureAirport = normalizeAirport(args.departureAirport);
		}
		if (args.arrivalAirport !== undefined) {
			patch.arrivalAirport = normalizeAirport(args.arrivalAirport);
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
		if (args.notes !== undefined) {
			patch.notes = args.notes?.trim() || undefined;
		}

		await ctx.db.patch('tripSegments', segment._id, patch);
		return segment._id;
	}
});

export const removeTripSegment = mutation({
	args: { segmentId: v.id('tripSegments') },
	handler: async (ctx, args) => {
		const { segment } = await requireSegment(ctx, args.segmentId);
		await ctx.db.delete('tripSegments', segment._id);
		return null;
	}
});

/**
 * The "different flights" action on a roster row (§5).
 *
 * Copies the GROUP legs onto one attendee, prefilled, so the coordinator edits
 * the two fields that differ instead of retyping a four-leg itinerary. This is
 * the duplicate-and-edit flow the plan chose over building a second itinerary
 * builder: one dialog, reused, and the model was already there.
 *
 * It refuses rather than merges when the traveller already has legs of their
 * own. Copying on top would leave two overlapping sets with no way to tell
 * which was typed and which was inherited, and an itinerary that quietly
 * doubles is worse than an error message.
 */
export const copyGroupSegmentsToAttendee = mutation({
	args: { attendeeId: v.id('tripAttendees') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const attendee = await ctx.db.get('tripAttendees', args.attendeeId);
		if (!attendee || attendee.orgId !== orgId) {
			throw new ConvexError('Trip attendee not found');
		}
		const trip = await requireTrip(ctx, orgId, attendee.tripId);
		await requireCapability(ctx, 'projects:write', trip.campaignId);

		const existing = await ctx.db
			.query('tripSegments')
			.withIndex('by_attendeeId', (q) => q.eq('attendeeId', attendee._id))
			.first();
		if (existing) {
			throw new ConvexError('That traveller already has their own flights');
		}

		const created: Id<'tripSegments'>[] = [];
		// Read in index order per direction so the copy keeps the group's leg
		// order without a sort — DFW->DOH stays leg 0.
		for (const direction of ['outbound', 'return'] as const) {
			const legs = await ctx.db
				.query('tripSegments')
				.withIndex('by_tripId_and_direction_and_order', (q) =>
					q.eq('tripId', trip._id).eq('direction', direction)
				)
				.collect();

			for (const leg of legs) {
				// Group legs only. A leg already belonging to another traveller is
				// somebody else's deviation and is not this person's default.
				if (leg.attendeeId !== undefined) continue;

				created.push(
					await ctx.db.insert('tripSegments', {
						orgId,
						tripId: trip._id,
						attendeeId: attendee._id,
						direction: leg.direction,
						order: leg.order,
						airline: leg.airline,
						flightNumber: leg.flightNumber,
						departureAirport: leg.departureAirport,
						arrivalAirport: leg.arrivalAirport,
						departureAt: leg.departureAt,
						arrivalAt: leg.arrivalAt,
						departureTimeZone: leg.departureTimeZone,
						arrivalTimeZone: leg.arrivalTimeZone,
						// The confirmation code is NOT copied: it is one traveller's
						// booking reference, and inheriting the group's would put a code
						// that is not theirs on a ticket somebody reads at a check-in
						// desk. Notes are not copied for the same reason — they describe
						// the group's leg, not this deviation.
						confirmationCode: undefined,
						notes: undefined
					})
				);
			}
		}

		if (created.length === 0) {
			throw new ConvexError('This trip has no group flights to copy yet');
		}

		return created;
	}
});
