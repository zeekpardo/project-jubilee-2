import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireCapability } from '../model/access';
import { deleteTripCascade } from '../model/cascade';

// No trips capability exists. Every write here gates on projects:write against
// the trip's OWN campaign — see PLAN-trips.md §9 and the note in queries.ts.

async function requireCampaign(
	ctx: MutationCtx,
	orgId: string,
	campaignId: Id<'campaigns'>
): Promise<Doc<'campaigns'>> {
	const campaign = await ctx.db.get('campaigns', campaignId);
	if (!campaign || campaign.orgId !== orgId) {
		throw new ConvexError('Campaign not found');
	}
	return campaign;
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

const statusValidator = v.union(
	v.literal('planning'),
	v.literal('confirmed'),
	v.literal('completed'),
	v.literal('cancelled')
);

/**
 * Uppercased on write for the same reason contacts.emailLower is stored
 * alongside the address: countryCode exists to GROUP by, and 'pk' and 'PK'
 * group apart. A blank string is not a country and is stored as absent.
 */
function normaliseCountryCode(value: string | null | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed.toUpperCase() : undefined;
}

/**
 * A trip cannot end before it starts.
 *
 * Both are ISO YYYY-MM-DD calendar days (PLAN-trips.md §2), and that format is
 * what makes this a plain string comparison rather than a date parse — the
 * lexical order of an ISO day IS its chronological order, which is most of the
 * reason the schema stores days this way instead of epoch ms.
 *
 * Enforced here rather than left to the form, because the itinerary math and
 * the "soonest first" ordering both assume a forward interval, and a reversed
 * one produces a trip that sorts into the past and renders a negative length.
 */
function requireForwardDates(startOn: string, endOn: string): void {
	if (endOn < startOn) {
		throw new ConvexError('A trip cannot end before it starts');
	}
}

/**
 * `name` arrives already composed.
 *
 * The `{Campaign} — {Project} — {startOn}` prefill of §15 is the create
 * dialog's job, not this mutation's: at the moment a name is generated there is
 * usually no project linked yet, and once the trip exists the name is the
 * user's — every further project added on the trip page leaves it alone. Same
 * contract as updates.slug, and for the same reason: a handle that silently
 * rewrites itself is not a handle.
 *
 * `projectId` is that same optional picker's second job — it seeds the first
 * tripProjects row. Absent is normal: a trip may exist in August with the
 * family visits decided in October.
 */
export const createTrip = mutation({
	args: {
		campaignId: v.id('campaigns'),
		name: v.string(),
		startOn: v.string(),
		endOn: v.string(),
		destination: v.string(),
		countryCode: v.optional(v.string()),
		status: v.optional(statusValidator),
		summary: v.optional(v.string()),
		notes: v.optional(v.string()),
		projectId: v.optional(v.id('projects'))
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write', args.campaignId);
		await requireCampaign(ctx, orgId, args.campaignId);
		requireForwardDates(args.startOn, args.endOn);

		if (args.projectId !== undefined) {
			const project = await ctx.db.get('projects', args.projectId);
			// A trip visits its own campaign's records. Seeding the link from
			// another campaign's project would put a record on an itinerary its
			// campaign's people cannot even read.
			if (!project || project.orgId !== orgId || project.campaignId !== args.campaignId) {
				throw new ConvexError('Project not found');
			}
		}

		const tripId = await ctx.db.insert('trips', {
			orgId,
			campaignId: args.campaignId,
			name: args.name,
			startOn: args.startOn,
			endOn: args.endOn,
			destination: args.destination,
			countryCode: normaliseCountryCode(args.countryCode),
			status: args.status ?? 'planning',
			summary: args.summary,
			notes: args.notes
		});

		if (args.projectId !== undefined) {
			await ctx.db.insert('tripProjects', {
				orgId,
				tripId,
				projectId: args.projectId
			});
		}

		return tripId;
	}
});

// campaignId is deliberately absent — a trip belongs to the campaign whose work
// it goes to do, and moving it would strand its attendees, whose rows carry
// campaignId directly.
export const updateTrip = mutation({
	args: {
		tripId: v.id('trips'),
		name: v.optional(v.string()),
		startOn: v.optional(v.string()),
		endOn: v.optional(v.string()),
		destination: v.optional(v.string()),
		// null (or a blank string) clears these three — see the normalization
		// below, the same shape updateProject uses for publicName.
		countryCode: v.optional(v.union(v.string(), v.null())),
		status: v.optional(statusValidator),
		summary: v.optional(v.union(v.string(), v.null())),
		notes: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const trip = await requireTrip(ctx, orgId, args.tripId);
		await requireCapability(ctx, 'projects:write', trip.campaignId);

		// Checked against what is STORED, not only against what arrived: an edit
		// that moves the start date alone still has to clear the existing end
		// date, and a patch validating only the fields it carries would let one
		// field at a time walk the interval backwards.
		requireForwardDates(args.startOn ?? trip.startOn, args.endOn ?? trip.endOn);

		const patch: Partial<Doc<'trips'>> = {};
		if (args.name !== undefined) patch.name = args.name;
		if (args.startOn !== undefined) patch.startOn = args.startOn;
		if (args.endOn !== undefined) patch.endOn = args.endOn;
		if (args.destination !== undefined) patch.destination = args.destination;
		if (args.status !== undefined) patch.status = args.status;
		if (args.countryCode !== undefined) patch.countryCode = normaliseCountryCode(args.countryCode);
		if (args.summary !== undefined) patch.summary = args.summary?.trim() || undefined;
		if (args.notes !== undefined) patch.notes = args.notes?.trim() || undefined;

		await ctx.db.patch('trips', trip._id, patch);
		return trip._id;
	}
});

export const deleteTrip = mutation({
	args: {
		tripId: v.id('trips')
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const trip = await requireTrip(ctx, orgId, args.tripId);
		await requireCapability(ctx, 'projects:write', trip.campaignId);

		await deleteTripCascade(ctx, trip._id);
		return null;
	}
});

/**
 * Many-to-many in both directions, and optional in both: one trip visits
 * several records, and the same record is visited again on next year's trip.
 *
 * Linking a record to a trip changes NOTHING about the record — in particular
 * the trip's attendees do not become projectMembers. That is the whole
 * served-versus-team distinction of §1, and undoing it here would defeat the
 * feature.
 */
export const linkTripProject = mutation({
	args: {
		tripId: v.id('trips'),
		projectId: v.id('projects'),
		note: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const trip = await requireTrip(ctx, orgId, args.tripId);
		await requireCapability(ctx, 'projects:write', trip.campaignId);

		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== orgId || project.campaignId !== trip.campaignId) {
			throw new ConvexError('Project not found');
		}

		// Convex has no unique constraints; unique(tripId, projectId) is enforced
		// here. A duplicate link would render the record twice on the itinerary
		// and delete only half of itself on unlink.
		const existing = await ctx.db
			.query('tripProjects')
			.withIndex('by_tripId_and_projectId', (q) =>
				q.eq('tripId', trip._id).eq('projectId', project._id)
			)
			.first();
		if (existing) {
			throw new ConvexError('That record is already on this trip');
		}

		return await ctx.db.insert('tripProjects', {
			orgId,
			tripId: trip._id,
			projectId: project._id,
			note: args.note?.trim() || undefined
		});
	}
});

// "Half day, morning only" — trip-specific, so it lives on the link and is
// edited here rather than by unlinking and linking again.
export const setTripProjectNote = mutation({
	args: {
		tripProjectId: v.id('tripProjects'),
		note: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');

		const link = await ctx.db.get('tripProjects', args.tripProjectId);
		if (!link || link.orgId !== orgId) {
			throw new ConvexError('Trip record link not found');
		}
		const trip = await requireTrip(ctx, orgId, link.tripId);
		await requireCapability(ctx, 'projects:write', trip.campaignId);

		await ctx.db.patch('tripProjects', link._id, { note: args.note?.trim() || undefined });
		return link._id;
	}
});

// Drops the link only. The record and the trip both survive it.
export const unlinkTripProject = mutation({
	args: {
		tripProjectId: v.id('tripProjects')
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');

		const link = await ctx.db.get('tripProjects', args.tripProjectId);
		if (!link || link.orgId !== orgId) {
			return null;
		}
		const trip = await requireTrip(ctx, orgId, link.tripId);
		await requireCapability(ctx, 'projects:write', trip.campaignId);

		await ctx.db.delete('tripProjects', link._id);
		return null;
	}
});
