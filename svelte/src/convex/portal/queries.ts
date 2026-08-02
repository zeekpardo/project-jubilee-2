// ============================================================
// Reading the portal
// ============================================================
// Every handler here starts with `resolvePortalViewer`, which takes no
// arguments and resolves the viewer from the session. Nothing in this file
// accepts an identity, and nothing may be added that does: the one rule the
// reference app's portal got right, and stated in the same words, is that a
// function must never take an id the caller could have chosen.
//
// A missing viewer is an EMPTY result, never an error. Access can be withdrawn
// while a subscription is live, and the surface emptying out is the correct
// response to that — the check is in `resolvePortalViewer` and happens on
// every read, not once at sign-in.
//
// What each handler is allowed to return is decided in `model/portal.ts`, in
// its header. This file joins and bounds; it does not project.
// ============================================================

import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { resolvePortalViewer, type PortalViewer } from '../model/identity';
import {
	PORTAL_RECORD_MAX,
	portalConnections,
	portalGiving,
	toPortalOwnRecord,
	toPortalProfile,
	toPortalRecord,
	type PortalConnection,
	type PortalRecord
} from '../model/portal';
import { isAssignedToViewer } from '../../lib/features/tasks/filters';

/**
 * The ceiling on one portal task read.
 *
 * `tasks` has no assignee index — the field is optional and polymorphic, so it
 * carries none — which leaves `by_orgId_and_status` as the only bounded way in.
 * That is a scan of the ORG's open tasks, filtered here to the viewer's.
 *
 * Deliberately NOT solved with a new index yet. The candidate is a nested-path
 * index on `assignee.contactId`, and it would be the right answer at a size
 * this app has not reached; choosing it now would be picking a schema change
 * over a measurement. What makes the scan safe to ship meanwhile is that it
 * says when it was cut: `truncated` is returned, and a short list that admits
 * it is short is not the same failure as one that silently looks complete.
 *
 * The number to watch is open tasks per org. Past a few thousand, a portal
 * member's own tasks can fall outside this window and the index stops being
 * optional.
 */
export const PORTAL_TASK_SCAN_MAX = 2000;

/** How many of their own tasks one read returns, after filtering. */
export const PORTAL_TASK_MAX = 200;

const EMPTY_GIVING = {
	gifts: [],
	lifetimeCents: 0,
	giftCount: 0,
	firstGiftOn: null,
	lastGiftOn: null,
	truncated: false
};

/**
 * Load the projects a connection map names, with their campaigns, and build
 * the public card for each. Unpublished records drop out — see
 * `toPortalRecord` for why giving to one does not conjure a page.
 */
async function buildRecords(
	ctx: QueryCtx,
	viewer: PortalViewer,
	connections: Map<Id<'projects'>, PortalConnection>
): Promise<PortalRecord[]> {
	const campaigns = new Map<string, Doc<'campaigns'>>();
	const records: PortalRecord[] = [];

	for (const [projectId, connection] of connections) {
		if (records.length >= PORTAL_RECORD_MAX) break;

		const project = await ctx.db.get('projects', projectId);
		if (!project || project.orgId !== viewer.orgId) continue;

		let campaign = campaigns.get(project.campaignId);
		if (!campaign) {
			const loaded = await ctx.db.get('campaigns', project.campaignId);
			if (!loaded || loaded.orgId !== viewer.orgId) continue;
			campaign = loaded;
			campaigns.set(project.campaignId, loaded);
		}

		const record = await toPortalRecord(ctx, project, campaign, connection);
		if (record) records.push(record);
	}

	return records;
}

/**
 * The portal's front page: who they are, what they have given, and how many
 * records that connects them to. One read rather than three, because the
 * greeting and the summary always render together.
 */
export const getPortalOverview = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await resolvePortalViewer(ctx);
		if (!viewer) return null;

		const connections = await portalConnections(ctx, viewer);

		return {
			profile: toPortalProfile(viewer.contact),
			giving: await portalGiving(ctx, viewer),
			recordCount: connections.size
		};
	}
});

/** Their donations, newest first, with the per-record split of each. */
export const listPortalGiving = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await resolvePortalViewer(ctx);
		if (!viewer) return EMPTY_GIVING;
		return await portalGiving(ctx, viewer);
	}
});

/** The records they are connected to, as public cards, filtered by connection. */
export const listPortalRecords = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await resolvePortalViewer(ctx);
		if (!viewer) return [];
		return await buildRecords(ctx, viewer, await portalConnections(ctx, viewer));
	}
});

/**
 * One record, addressed by its public `number` the way the wall addresses
 * everything. Returns the own-record projection when the viewer is someone the
 * record serves, and the public card otherwise — a supporter reading a family's
 * page sees what any visitor sees.
 *
 * A number they have no connection to resolves to null, not to a public card.
 * The portal is not a second route to the public site.
 */
export const getPortalRecord = query({
	args: { number: v.string() },
	handler: async (ctx, args) => {
		const viewer = await resolvePortalViewer(ctx);
		if (!viewer) return null;

		const project = await ctx.db
			.query('projects')
			.withIndex('by_orgId_and_number', (q) => q.eq('orgId', viewer.orgId).eq('number', args.number))
			.unique();
		if (!project) return null;

		const connections = await portalConnections(ctx, viewer);
		const connection = connections.get(project._id);
		if (!connection) return null;

		const campaign = await ctx.db.get('campaigns', project.campaignId);
		if (!campaign || campaign.orgId !== viewer.orgId) return null;

		if (connection.belongsTo) {
			const own = await toPortalOwnRecord(ctx, viewer, project, campaign);
			if (own) return { kind: 'own' as const, connection, ...own };
		}

		const record = await toPortalRecord(ctx, project, campaign, connection);
		return record ? { kind: 'public' as const, ...record } : null;
	}
});

/**
 * The tasks assigned to them.
 *
 * `isAssignedToViewer` is the same rule the staff list uses — the one place an
 * assignee is compared to a person — given a viewer whose two halves are
 * already known, because a portal viewer IS a contact and arrived with their
 * account id. Nothing is re-derived here.
 *
 * Only open tasks. A donor's or attendee's portal is a list of what is still
 * expected of them; their completed history is the organization's record, not
 * a to-do list.
 */
export const listPortalTasks = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await resolvePortalViewer(ctx);
		if (!viewer) return { tasks: [], truncated: false };

		const scanned = await ctx.db
			.query('tasks')
			.withIndex('by_orgId_and_status', (q) => q.eq('orgId', viewer.orgId).eq('status', 'todo'))
			.take(PORTAL_TASK_SCAN_MAX + 1);

		const truncated = scanned.length > PORTAL_TASK_SCAN_MAX;
		const person = { userId: viewer.userId, contactId: viewer.contact._id as string };

		const mine = scanned
			.slice(0, PORTAL_TASK_SCAN_MAX)
			.filter((task) => isAssignedToViewer(task.assignee, person))
			.slice(0, PORTAL_TASK_MAX);

		const tasks = [];
		for (const task of mine) {
			// The record a task names is shown by its PUBLIC identity, the same as
			// everywhere else in the portal: the number always, the name only if an
			// admin published one.
			const project = task.projectId ? await ctx.db.get('projects', task.projectId) : null;
			tasks.push({
				id: task._id,
				label: task.label,
				description: task.description ?? null,
				dueOn: task.dueOn ?? null,
				priority: task.priority,
				recordNumber: project?.number ?? null,
				recordName: project?.publicName?.trim() || null
			});
		}

		// Soonest first, undated last: an absent due date sorts before every real
		// one as a string, which would put the least urgent work on top.
		tasks.sort((a, b) => (a.dueOn ?? '9999-12-31').localeCompare(b.dueOn ?? '9999-12-31'));

		return { tasks, truncated };
	}
});

/** Their own details, as the profile page shows them. */
export const getPortalProfile = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await resolvePortalViewer(ctx);
		if (!viewer) return null;
		return toPortalProfile(viewer.contact);
	}
});
