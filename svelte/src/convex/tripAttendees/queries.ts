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
import { isPersonReachedRole } from '../../lib/domain/campaign-stats';

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

/**
 * Who may be put on a trip, ranked so the likely answer comes first.
 *
 * A trip roster is the ORGANIZATION'S OWN PEOPLE — the `team` side of §1 — but
 * the contact book holds everyone, and the families a campaign serves sit in it
 * beside its staff. Offering both in one flat alphabetical list is how a tired
 * admin searching "Rahman" puts the family they are going to VISIT on the
 * aeroplane.
 *
 * So this does not filter them out; it ranks and labels. Filtering would be
 * wrong — a person the campaign serves genuinely does travel with the team
 * sometimes, and a picker that refuses to show them makes that unrecordable.
 * Ranking makes the common mistake visibly wrong while leaving the uncommon
 * truth expressible, which is the same trade `isPersonReachedRole` makes with
 * its denylist rather than an allowlist.
 *
 * `servesOnRecord` is decided by isPersonReachedRole — deliberately the SAME
 * predicate that decides whether someone counts toward a published impact
 * number. So this badge always says exactly what the statistics currently
 * believe: a legacy `volunteer` row with no `side` reads as served here for
 * precisely as long as it is inflating `people_reached`, and correcting it on
 * the member-sides screen (§13) fixes both at once. A second, kinder heuristic
 * here would let the picker and the published number disagree about the same
 * person, which is worse than either being wrong alone.
 */
export const listTripCandidates = query({
	args: { tripId: v.id('trips'), search: v.optional(v.string()), limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return [];

		const trip = await ctx.db.get('trips', args.tripId);
		if (!trip || trip.orgId !== access.orgId) return [];
		if (!can(access, 'projects:write', trip.campaignId)) return [];
		if (!can(access, 'contacts:read', trip.campaignId)) return [];

		const take = Math.min(args.limit ?? 50, 100);
		const needle = args.search?.trim().toLowerCase();

		// `.eq('orgId', ...)` is the tenant boundary on BOTH branches. A search
		// index does not inherit the isolation the by_orgId index gives for
		// free — the same note listContacts carries, and the same reason.
		const contacts =
			needle === undefined || needle === ''
				? await ctx.db
						.query('contacts')
						.withIndex('by_orgId', (q) => q.eq('orgId', access.orgId as string))
						.take(take)
				: await ctx.db
						.query('contacts')
						.withSearchIndex('search_contacts', (q) =>
							q.search('searchText', needle).eq('orgId', access.orgId as string)
						)
						.take(take);

		// Anyone already travelling is not offered again — unique(tripId, contactId).
		const roster = await ctx.db
			.query('tripAttendees')
			.withIndex('by_tripId', (q) => q.eq('tripId', trip._id))
			.collect();
		const onTrip = new Set(roster.map((row) => row.contactId as string));

		const rows = [];
		for (const contact of contacts) {
			if (onTrip.has(contact._id as string)) continue;

			// Bounded by `take`, and each lookup is a single index read on a link
			// table most people have no rows in at all.
			const links = await ctx.db
				.query('projectMembers')
				.withIndex('by_contactId', (q) => q.eq('contactId', contact._id))
				.collect();

			const servesOnRecord = links.some(
				(link) => link.orgId === access.orgId && isPersonReachedRole(link.role, link.side)
			);

			rows.push({
				_id: contact._id,
				firstName: contact.firstName,
				lastName: contact.lastName,
				email: contact.email,
				servesOnRecord
			});
		}

		// Org-side people first, then anyone the campaign serves; alphabetical
		// within each group so the list is still scannable.
		return rows.sort((a, b) => {
			if (a.servesOnRecord !== b.servesOnRecord) return a.servesOnRecord ? 1 : -1;
			return `${a.firstName} ${a.lastName ?? ''}`.localeCompare(`${b.firstName} ${b.lastName ?? ''}`);
		});
	}
});
