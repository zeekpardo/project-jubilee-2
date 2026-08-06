// The shapes the trip UI renders.
//
// Derived from the queries rather than re-declared, exactly as
// `features/tasks/rows.ts` does it: a column added or renamed server-side
// surfaces as a type error here instead of silently rendering blank.

import type { FunctionReturnType } from 'convex/server';
import type { api } from '$convex/_generated/api';

export type TripRow = FunctionReturnType<typeof api.trips.queries.listTrips>[number];

/** One roster row, with the contact joined on. */
export type TripAttendeeRow = FunctionReturnType<
	typeof api.tripAttendees.queries.listTripAttendees
>[number];

/** One flight leg. `attendeeId` absent = the group itinerary. */
export type TripSegmentRow = FunctionReturnType<
	typeof api.tripSegments.queries.listTripSegments
>[number];

export type TripBudgetLineRow = FunctionReturnType<
	typeof api.tripBudgetLines.queries.listTripBudgetLines
>[number];

/** A tripProjects link with the record trimmed to what the block renders. */
export type TripProjectRow = FunctionReturnType<
	typeof api.trips.queries.listProjectsForTrip
>[number];
