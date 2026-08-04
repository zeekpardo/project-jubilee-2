import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAccess } from '../model/access';
import { can } from '../../lib/domain/permissions';

// Trips carry NO capability of their own — they are gated on projects:read /
// projects:write, campaign-scoped. A team leader assigned to the campaign does
// the campaign's operational work, including the trip they are on; a campaign
// manager runs it. See PLAN-trips.md §9.

const statusValidator = v.union(
	v.literal('planning'),
	v.literal('confirmed'),
	v.literal('completed'),
	v.literal('cancelled')
);

/**
 * The working trip list, soonest first.
 *
 * Both shapes read in index order rather than sorting a page in the handler:
 * `by_campaignId_and_startOn` for a campaign's tab, `by_orgId_and_startOn` for
 * /app/trips. Convex orders ascending over the index key, and ascending startOn
 * IS soonest first.
 *
 * The org-wide branch filters per row against the row's OWN campaign. Gating
 * once with no campaignId asks "may they read trips anywhere at all", which is
 * the right question for reaching the page and the wrong one for deciding what
 * goes on it — a leader assigned to one campaign would otherwise be handed
 * every other campaign's itinerary.
 */
export const listTrips = query({
	args: {
		campaignId: v.optional(v.id('campaigns')),
		status: v.optional(statusValidator)
	},
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) {
			return [];
		}
		if (!can(access, 'projects:read', args.campaignId ?? null)) {
			return [];
		}
		const orgId = access.orgId;

		if (args.campaignId !== undefined) {
			const campaign = await ctx.db.get('campaigns', args.campaignId);
			if (!campaign || campaign.orgId !== orgId) {
				return [];
			}
			const campaignId = args.campaignId;

			const rows = await ctx.db
				.query('trips')
				.withIndex('by_campaignId_and_startOn', (q) => q.eq('campaignId', campaignId))
				.collect();
			return args.status === undefined ? rows : rows.filter((row) => row.status === args.status);
		}

		const rows = await ctx.db
			.query('trips')
			.withIndex('by_orgId_and_startOn', (q) => q.eq('orgId', orgId))
			.collect();
		return rows.filter(
			(row) =>
				can(access, 'projects:read', row.campaignId) &&
				(args.status === undefined || row.status === args.status)
		);
	}
});

export const getTrip = query({
	args: {
		tripId: v.id('trips')
	},
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) {
			return null;
		}

		const trip = await ctx.db.get('trips', args.tripId);
		if (!trip || trip.orgId !== access.orgId) {
			return null;
		}
		if (!can(access, 'projects:read', trip.campaignId)) {
			return null;
		}

		return trip;
	}
});

/**
 * The records this trip visits.
 *
 * The link document is returned whole — it is three ids and a note — while the
 * project is trimmed to what the Projects block renders. Spreading the project
 * here would put a family's story and attribute bag on a page about flights.
 */
export const listProjectsForTrip = query({
	args: {
		tripId: v.id('trips')
	},
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) {
			return [];
		}

		const trip = await ctx.db.get('trips', args.tripId);
		if (!trip || trip.orgId !== access.orgId) {
			return [];
		}
		if (!can(access, 'projects:read', trip.campaignId)) {
			return [];
		}

		const links = await ctx.db
			.query('tripProjects')
			.withIndex('by_tripId', (q) => q.eq('tripId', trip._id))
			.collect();

		return await Promise.all(
			links.map(async (link) => {
				const project = await ctx.db.get('projects', link.projectId);
				return {
					...link,
					project: project ? { _id: project._id, number: project.number, name: project.name } : null
				};
			})
		);
	}
});

/**
 * Which trips visited this record, and when. Two lines in the project overview
 * for most records, which is why the trip is trimmed rather than spread.
 */
export const listTripsForProject = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) {
			return [];
		}

		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== access.orgId) {
			return [];
		}
		if (!can(access, 'projects:read', project.campaignId)) {
			return [];
		}

		const links = await ctx.db
			.query('tripProjects')
			.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
			.collect();

		return await Promise.all(
			links.map(async (link) => {
				const trip = await ctx.db.get('trips', link.tripId);
				return {
					...link,
					trip: trip
						? {
								_id: trip._id,
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
