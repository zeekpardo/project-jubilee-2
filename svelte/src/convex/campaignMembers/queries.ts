import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAccess } from '../model/access';
import { can } from '../../lib/domain/permissions';
import type { Doc, Id } from '../_generated/dataModel';

/**
 * Everyone connected to a campaign, from ALL THREE directions: people
 * explicitly added to it, people on one of its records, and people travelling
 * on one of its trips. Someone put on a record — or on a trip — is plainly part
 * of that campaign, so deriving the other two sources here avoids asking anyone
 * to add them twice and keeps them from drifting apart.
 *
 * Nothing writes a `campaignMemberships` row on their behalf: a derived row is
 * always current, while a copied one is a second fact that can go stale the
 * moment somebody leaves the trip.
 *
 * A row with no `membershipId` exists only through a record or a trip; its role
 * cannot be edited here because there is no membership to edit.
 */
export const listCampaignMembers = query({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return [];
		if (!can(access, 'contacts:read', args.campaignId)) return [];

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== access.orgId) return [];

		type Row = {
			contactId: Id<'contacts'>;
			contact: Doc<'contacts'> | null;
			membershipId: Id<'campaignMemberships'> | null;
			role: string | null;
			viaProjects: { number: string; name: string; role: string }[];
			viaTrips: { tripId: Id<'trips'>; name: string; startOn: string; role: string | null }[];
		};

		const byContact = new Map<string, Row>();

		const memberships = await ctx.db
			.query('campaignMemberships')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.collect();

		for (const membership of memberships) {
			byContact.set(membership.contactId as string, {
				contactId: membership.contactId,
				contact: await ctx.db.get('contacts', membership.contactId),
				membershipId: membership._id,
				role: membership.role,
				viaProjects: [],
				viaTrips: []
			});
		}

		const projects = await ctx.db
			.query('projects')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.collect();

		for (const project of projects) {
			const links = await ctx.db
				.query('projectMembers')
				.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
				.collect();

			for (const link of links) {
				const key = link.contactId as string;
				const existing = byContact.get(key);
				const via = { number: project.number, name: project.name, role: link.role };
				if (existing) {
					existing.viaProjects.push(via);
					continue;
				}
				byContact.set(key, {
					contactId: link.contactId,
					contact: await ctx.db.get('contacts', link.contactId),
					membershipId: null,
					role: null,
					viaProjects: [via],
					viaTrips: []
				});
			}
		}

		// The third source: people travelling on one of this campaign's trips.
		// Read by `campaignId`, which the attendee row carries directly rather
		// than reaching for through its trip — traversing could pick up a row
		// belonging to another campaign, which is exactly why the column is there.
		const attendees = await ctx.db
			.query('tripAttendees')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.collect();

		// One person may be on several trips in this campaign (the whole point of
		// keying attendance to the trip), so trips are cached rather than fetched
		// once per attendee row.
		const tripsById = new Map<string, Doc<'trips'> | null>();

		for (const attendee of attendees) {
			if (attendee.orgId !== access.orgId) continue;

			const tripKey = attendee.tripId as string;
			if (!tripsById.has(tripKey)) {
				tripsById.set(tripKey, await ctx.db.get('trips', attendee.tripId));
			}
			const trip = tripsById.get(tripKey);
			if (!trip) continue;

			const key = attendee.contactId as string;
			const existing = byContact.get(key);
			const via = {
				tripId: attendee.tripId,
				name: trip.name,
				startOn: trip.startOn,
				// Free text and optional — "Coordinator", or nothing at all. Unlike a
				// project link's role, there is no default worth inventing here.
				role: attendee.role ?? null
			};
			if (existing) {
				existing.viaTrips.push(via);
				continue;
			}
			byContact.set(key, {
				contactId: attendee.contactId,
				contact: await ctx.db.get('contacts', attendee.contactId),
				membershipId: null,
				role: null,
				viaProjects: [],
				viaTrips: [via]
			});
		}

		return [...byContact.values()];
	}
});

/**
 * Campaigns a contact belongs to.
 *
 * Takes any contactId, so the gate is the whole protection: `contacts:read`,
 * asked once per membership against that membership's OWN campaign. Asking
 * per row rather than once org-wide matters because the argument names a
 * person rather than a campaign — a leader assigned to one campaign would
 * otherwise learn every other campaign a contact belongs to by passing an id.
 *
 * Neither document is spread. The membership row carries an `attributes`
 * record this screen never reads, and the campaign document carries the whole
 * campaign; both are trimmed to what `CampaignsTab.svelte` actually renders.
 */
export const listCampaignsForContact = query({
	args: { contactId: v.id('contacts') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return [];
		if (!can(access, 'contacts:read')) return [];

		const links = await ctx.db
			.query('campaignMemberships')
			.withIndex('by_contactId', (q) => q.eq('contactId', args.contactId))
			.collect();

		const mine = links.filter(
			(link) => link.orgId === access.orgId && can(access, 'contacts:read', link.campaignId)
		);
		return await Promise.all(
			mine.map(async (link) => {
				const campaign = await ctx.db.get('campaigns', link.campaignId);
				return {
					_id: link._id,
					role: link.role,
					campaign: campaign ? { name: campaign.name } : null
				};
			})
		);
	}
});
