// ============================================================
// Reading flight legs
// ============================================================
// Every read goes through `by_tripId_and_direction_and_order`, so legs arrive
// in the order they are flown and no handler sorts them. Outbound first, then
// return, which is the order the itinerary block renders.
//
// Nothing here computes with the times. `departureAt` / `arrivalAt` are wall
// clock strings and the arithmetic — leg duration, layover, whether an arrival
// lands the next calendar day, merging a traveller's legs over the group set —
// belongs to the pure, tested `lib/domain/trip-itinerary.ts`. A query that
// started parsing these with `new Date()` would resolve them in the server's
// zone, which is the one place the mistake would never show up in a test.
//
// ACCESS (§9). `projects:read`, scoped to the trip's own campaign. A denied
// read is an empty list, not an error.
// ============================================================

import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { getAccess } from '../model/access';
import { can } from '../../lib/domain/permissions';

const DIRECTIONS = ['outbound', 'return'] as const;

async function legsInFlightOrder(
	ctx: QueryCtx,
	tripId: Id<'trips'>
): Promise<Doc<'tripSegments'>[]> {
	const legs: Doc<'tripSegments'>[] = [];
	for (const direction of DIRECTIONS) {
		legs.push(
			...(await ctx.db
				.query('tripSegments')
				.withIndex('by_tripId_and_direction_and_order', (q) =>
					q.eq('tripId', tripId).eq('direction', direction)
				)
				.collect())
		);
	}
	return legs;
}

/**
 * Every leg of a trip — the group itinerary and each traveller's deviations, in
 * one list. `attendeeId` tells them apart, and the page folds the per-person
 * ones under their traveller.
 */
export const listTripSegments = query({
	args: { tripId: v.id('trips') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return [];

		const trip = await ctx.db.get('trips', args.tripId);
		if (!trip || trip.orgId !== access.orgId) return [];
		if (!can(access, 'projects:read', trip.campaignId)) return [];

		return await legsInFlightOrder(ctx, trip._id);
	}
});

/**
 * The GROUP itinerary alone — what most of the roster is flying.
 *
 * The group/per-person split cannot be an index range: `attendeeId` is absent
 * on a group leg, and an index cannot be asked for "no value here". So the
 * filter is in memory, over rows the index has already narrowed to one trip and
 * ordered — bounded by the legs of a single trip, which is tens of rows.
 */
export const listGroupTripSegments = query({
	args: { tripId: v.id('trips') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return [];

		const trip = await ctx.db.get('trips', args.tripId);
		if (!trip || trip.orgId !== access.orgId) return [];
		if (!can(access, 'projects:read', trip.campaignId)) return [];

		const legs = await legsInFlightOrder(ctx, trip._id);
		return legs.filter((leg) => leg.attendeeId === undefined);
	}
});

/**
 * One traveller's own legs.
 *
 * Read through the trip's direction/order index rather than `by_attendeeId`,
 * because that index is keyed only by attendee and would hand back legs in no
 * particular order — the pickup list would show the connection before the
 * departure. `by_attendeeId` earns its keep on deletes, where order is
 * irrelevant.
 */
export const listTripSegmentsForAttendee = query({
	args: { attendeeId: v.id('tripAttendees') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return [];

		const attendee = await ctx.db.get('tripAttendees', args.attendeeId);
		if (!attendee || attendee.orgId !== access.orgId) return [];
		if (!can(access, 'projects:read', attendee.campaignId)) return [];

		const legs = await legsInFlightOrder(ctx, attendee.tripId);
		return legs.filter((leg) => leg.attendeeId === attendee._id);
	}
});
