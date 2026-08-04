// ============================================================
// Writing a trip roster
// ============================================================
// Who is going on a trip. These rows are the `team` side of the work — the
// organization's own people — which is why they live here and never become
// `projectMembers` rows on the records the trip visits. See PLAN-trips.md §1.
//
// ACCESS. No trips capability exists: every write here is `projects:write`,
// scoped to the TRIP'S OWN campaign (§9). A trip is operational campaign work,
// so the leader who runs the campaign runs its trip. The campaign is only
// knowable after the trip row is read, so every handler gates twice — once
// org-wide to establish the caller, then again with `trip.campaignId` — the
// same shape `tasks/mutations.ts` uses.
//
// THE KEY. Uniqueness is (tripId, contactId) and deliberately NOT
// (campaignId, contactId): a person may go on several trips in the SAME
// campaign, and each journey has its own role, leader flag, status and flights.
// See `assertTripAttendeeUnique` below.
//
// CLEARING vs LEAVING ALONE. Convex cannot tell an omitted argument from one
// passed as `undefined`, and a role or a note genuinely needs to be removable,
// so those take `null` to mean CLEAR — the same convention `tasks` uses.
// ============================================================

import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireCapability } from '../model/access';
import { createContactModel } from '../model/contacts';

export const tripAttendeeStatusValidator = v.union(
	v.literal('invited'),
	v.literal('confirmed'),
	v.literal('declined'),
	v.literal('cancelled')
);

/** `null` clears the column; an absent argument leaves it alone. See the header. */
const clearableString = v.optional(v.union(v.string(), v.null()));

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

async function requireContact(
	ctx: MutationCtx,
	orgId: string,
	contactId: Id<'contacts'>
): Promise<Doc<'contacts'>> {
	const contact = await ctx.db.get('contacts', contactId);
	if (!contact || contact.orgId !== orgId) {
		throw new ConvexError('Contact not found');
	}
	return contact;
}

/**
 * Loads an attendee and re-gates on its own trip's campaign. Returns both,
 * because every caller needs the trip to gate and the row to patch.
 */
async function requireTripAttendee(
	ctx: MutationCtx,
	attendeeId: Id<'tripAttendees'>
): Promise<{ attendee: Doc<'tripAttendees'>; trip: Doc<'trips'>; orgId: string }> {
	const { orgId } = await requireCapability(ctx, 'projects:write');
	const attendee = await ctx.db.get('tripAttendees', attendeeId);
	if (!attendee || attendee.orgId !== orgId) {
		throw new ConvexError('Trip attendee not found');
	}
	const trip = await requireTrip(ctx, orgId, attendee.tripId);
	await requireCapability(ctx, 'projects:write', trip.campaignId);
	return { attendee, trip, orgId };
}

/**
 * unique(tripId, contactId) — Convex has no unique constraints, so the index
 * lookup is the constraint.
 *
 * TEST OF REASONING, because this is the key the rest of the codebase would
 * talk you out of: it is keyed to the TRIP, not the campaign. `campaignMemberships`
 * is keyed (campaignId, contactId, role), and copying that here — even as
 * role: 'trip_attendee' — makes a person's SECOND trip in the same campaign
 * either a duplicate-key error or, worse, an overwrite of the first trip's
 * roster. "A person can go on multiple trips in the same campaign" is a stated
 * requirement (§4), so December and March are two rows, each with its own role,
 * leader flag, status, checklist and flight legs. Adding a campaign-scoped
 * uniqueness check here would break that, silently, and only for the org that
 * runs two trips a year.
 */
async function assertTripAttendeeUnique(
	ctx: MutationCtx,
	tripId: Id<'trips'>,
	contactId: Id<'contacts'>
): Promise<void> {
	const existing = await ctx.db
		.query('tripAttendees')
		.withIndex('by_tripId_and_contactId', (q) => q.eq('tripId', tripId).eq('contactId', contactId))
		.first();
	if (existing) {
		throw new ConvexError('That person is already on this trip');
	}
}

/** Put someone who already exists in the org on a trip. */
export const addTripAttendee = mutation({
	args: {
		tripId: v.id('trips'),
		contactId: v.id('contacts'),
		role: v.optional(v.string()),
		isLeader: v.optional(v.boolean()),
		status: v.optional(tripAttendeeStatusValidator),
		notes: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const trip = await requireTrip(ctx, orgId, args.tripId);
		await requireCapability(ctx, 'projects:write', trip.campaignId);

		await requireContact(ctx, orgId, args.contactId);
		await assertTripAttendeeUnique(ctx, args.tripId, args.contactId);

		return await ctx.db.insert('tripAttendees', {
			orgId,
			tripId: trip._id,
			// Copied from the trip, never taken from an argument: the campaign is a
			// fact about the trip, and letting a caller name it would let a roster
			// row claim a campaign its trip does not belong to.
			campaignId: trip.campaignId,
			contactId: args.contactId,
			role: args.role?.trim() || undefined,
			isLeader: args.isLeader ?? false,
			// Invited is the honest default: adding somebody to the list is not the
			// same as them having said yes.
			status: args.status ?? 'invited',
			notes: args.notes?.trim() || undefined
		});
	}
});

/**
 * Create a person and put them on the trip in one step, so adding somebody new
 * does not mean leaving the trip page to make a contact first. Mirrors
 * `createCampaignMember`, and goes through `createContactModel` for the same
 * reason it does: one defaulted, deduped, primary-row-seeded contact shape,
 * whichever screen the person was typed into.
 *
 * Returns the ATTENDEE id rather than the contact id — unlike a campaign
 * membership, the roster row is what the page acts on next (toggle leader, set
 * role, copy the group's flights onto them).
 */
export const createTripAttendee = mutation({
	args: {
		tripId: v.id('trips'),
		firstName: v.string(),
		lastName: v.optional(v.string()),
		email: v.optional(v.string()),
		phone: v.optional(v.string()),
		role: v.optional(v.string()),
		isLeader: v.optional(v.boolean()),
		status: v.optional(tripAttendeeStatusValidator)
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const trip = await requireTrip(ctx, orgId, args.tripId);
		await requireCapability(ctx, 'projects:write', trip.campaignId);

		const firstName = args.firstName.trim();
		if (!firstName) throw new ConvexError('A traveller needs a first name');

		const contactId = await createContactModel(ctx, {
			orgId,
			firstName,
			lastName: args.lastName,
			email: args.email,
			phone: args.phone,
			source: 'trip'
		});

		return await ctx.db.insert('tripAttendees', {
			orgId,
			tripId: trip._id,
			campaignId: trip.campaignId,
			contactId,
			role: args.role?.trim() || undefined,
			isLeader: args.isLeader ?? false,
			status: args.status ?? 'invited'
		});
	}
});

/**
 * The parenthetical in "Eman Hernandez (Coordinator)". Free text on purpose —
 * an org spells its own vocabulary — which is exactly why it is NOT what the
 * Trip Leaders block reads. That is `isLeader`, below.
 */
export const setTripAttendeeRole = mutation({
	args: { attendeeId: v.id('tripAttendees'), role: v.union(v.string(), v.null()) },
	handler: async (ctx, args) => {
		const { attendee } = await requireTripAttendee(ctx, args.attendeeId);
		await ctx.db.patch('tripAttendees', attendee._id, {
			role: args.role?.trim() || undefined
		});
		return attendee._id;
	}
});

/**
 * A flag rather than role === 'leader', because the Trip Leaders block is an
 * index lookup (`by_tripId_and_isLeader`) and nothing should have to recognise
 * "Team Lead", "team_lead" and "Site Coordinator" as the same thing.
 */
export const setTripAttendeeLeader = mutation({
	args: { attendeeId: v.id('tripAttendees'), isLeader: v.boolean() },
	handler: async (ctx, args) => {
		const { attendee } = await requireTripAttendee(ctx, args.attendeeId);
		await ctx.db.patch('tripAttendees', attendee._id, { isLeader: args.isLeader });
		return attendee._id;
	}
});

/**
 * Where this person is in going — a fact about THIS journey and not about them.
 * Someone who declined December is still on the March roster, which is only
 * expressible because the row is keyed to the trip.
 */
export const setTripAttendeeStatus = mutation({
	args: { attendeeId: v.id('tripAttendees'), status: tripAttendeeStatusValidator },
	handler: async (ctx, args) => {
		const { attendee } = await requireTripAttendee(ctx, args.attendeeId);
		await ctx.db.patch('tripAttendees', attendee._id, { status: args.status });
		return attendee._id;
	}
});

export const setTripAttendeeNotes = mutation({
	args: { attendeeId: v.id('tripAttendees'), notes: clearableString },
	handler: async (ctx, args) => {
		const { attendee } = await requireTripAttendee(ctx, args.attendeeId);
		if (args.notes !== undefined) {
			await ctx.db.patch('tripAttendees', attendee._id, {
				notes: args.notes?.trim() || undefined
			});
		}
		return attendee._id;
	}
});

/**
 * Takes someone off a trip. The LINK only — the contact survives, same rule as
 * `removeCampaignMember` and `removeProjectMember`, because a person is
 * campaign-agnostic and being uninvited from a journey is not being deleted
 * from the organization.
 *
 * Their per-person flight legs go with them. A leg carries `attendeeId`, so a
 * leg left behind would point at a row that no longer exists and would render
 * on the itinerary with nobody's name against it — the same ordering rule
 * `deleteTripCascade` follows (segments before attendees, §10), applied here
 * because this is the one-attendee version of that delete.
 */
export const removeTripAttendee = mutation({
	args: { attendeeId: v.id('tripAttendees') },
	handler: async (ctx, args) => {
		const { attendee } = await requireTripAttendee(ctx, args.attendeeId);

		const ownLegs = await ctx.db
			.query('tripSegments')
			.withIndex('by_attendeeId', (q) => q.eq('attendeeId', attendee._id))
			.collect();
		for (const leg of ownLegs) {
			await ctx.db.delete('tripSegments', leg._id);
		}

		await ctx.db.delete('tripAttendees', attendee._id);
		return null;
	}
});
