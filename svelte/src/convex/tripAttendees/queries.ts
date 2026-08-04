// ============================================================
// Reading a trip roster
// ============================================================
// ACCESS (§9). No trips capability exists: reads are `projects:read`, scoped to
// the trip's own campaign. The roster ALSO checks `contacts:read`, because it
// resolves people and the joined rows carry the contact record — the same
// argument `listMembersForProject` makes about a query whose argument is a
// project but whose result is people.
//
// A denied read returns `[]` rather than throwing. A query runs on every
// subscription tick, and a viewer who may not see this should watch the surface
// empty out, not fill with error dialogs.
// ============================================================

import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAccess } from '../model/access';
import { can } from '../../lib/domain/permissions';

/**
 * The full roster, leaders first.
 *
 * Ordered by two index reads on `by_tripId_and_isLeader` rather than one read
 * and a sort: leaders and everyone else are two lookups the index already
 * separates, and concatenating them is the order the page renders in.
 */
export const listTripAttendees = query({
	args: { tripId: v.id('trips') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return [];

		const trip = await ctx.db.get('trips', args.tripId);
		if (!trip || trip.orgId !== access.orgId) return [];
		if (!can(access, 'projects:read', trip.campaignId)) return [];
		if (!can(access, 'contacts:read', trip.campaignId)) return [];

		const leaders = await ctx.db
			.query('tripAttendees')
			.withIndex('by_tripId_and_isLeader', (q) => q.eq('tripId', trip._id).eq('isLeader', true))
			.collect();
		const rest = await ctx.db
			.query('tripAttendees')
			.withIndex('by_tripId_and_isLeader', (q) => q.eq('tripId', trip._id).eq('isLeader', false))
			.collect();

		return await Promise.all(
			[...leaders, ...rest].map(async (attendee) => ({
				...attendee,
				contact: await ctx.db.get('contacts', attendee.contactId)
			}))
		);
	}
});

/**
 * Just the Trip Leaders block — "Eman Hernandez (Coordinator)": the name from
 * the contact, the parenthetical from `role`, and membership of this list from
 * the flag. Three fields, three sources, no string matching.
 */
export const listTripLeaders = query({
	args: { tripId: v.id('trips') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return [];

		const trip = await ctx.db.get('trips', args.tripId);
		if (!trip || trip.orgId !== access.orgId) return [];
		if (!can(access, 'projects:read', trip.campaignId)) return [];
		if (!can(access, 'contacts:read', trip.campaignId)) return [];

		const leaders = await ctx.db
			.query('tripAttendees')
			.withIndex('by_tripId_and_isLeader', (q) => q.eq('tripId', trip._id).eq('isLeader', true))
			.collect();

		return await Promise.all(
			leaders.map(async (attendee) => ({
				...attendee,
				contact: await ctx.db.get('contacts', attendee.contactId)
			}))
		);
	}
});

/**
 * Trips a person is on, for the contact detail page.
 *
 * Takes any contactId, so the gate is the whole protection: `projects:read`
 * asked once per row against that row's OWN campaign, exactly as
 * `listCampaignsForContact` does. Asking per row rather than once org-wide
 * matters because the argument names a person — a leader assigned to one
 * campaign would otherwise learn every other campaign's travel plans by
 * passing an id.
 *
 * The trip document is not spread; only what the tab renders.
 */
export const listTripsForContact = query({
	args: { contactId: v.id('contacts') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return [];
		if (!can(access, 'projects:read')) return [];

		const contact = await ctx.db.get('contacts', args.contactId);
		if (!contact || contact.orgId !== access.orgId) return [];

		const links = await ctx.db
			.query('tripAttendees')
			.withIndex('by_contactId', (q) => q.eq('contactId', contact._id))
			.collect();

		const mine = links.filter(
			(link) => link.orgId === access.orgId && can(access, 'projects:read', link.campaignId)
		);

		return await Promise.all(
			mine.map(async (link) => {
				const trip = await ctx.db.get('trips', link.tripId);
				return {
					_id: link._id,
					tripId: link.tripId,
					role: link.role ?? null,
					isLeader: link.isLeader,
					status: link.status,
					trip: trip
						? {
								name: trip.name,
								startOn: trip.startOn,
								endOn: trip.endOn,
								destination: trip.destination,
								status: trip.status
							}
						: null
				};
			})
		);
	}
});
