// ============================================================
// Reading the portal
// ============================================================
// Every handler that RETURNS PORTAL DATA starts with `resolvePortalViewer`,
// which takes no arguments and resolves the viewer from the session. Nothing
// in this file accepts an identity, and nothing may be added that does: the
// one rule the reference app's portal got right, and stated in the same words,
// is that a function must never take an id the caller could have chosen.
//
// `getPortalSituation` is the single handler that resolves no viewer, because
// its whole job is to explain why there isn't one. It returns no portal data —
// only a state, the caller's own email, and the org's public name — and it is
// keyed on the caller's own account throughout. Its docstring carries the
// enumeration argument in full; read it before adding a second exception.
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
import { authComponent } from '../auth';
import { getAccess } from '../model/access';
import { normalizeEmail } from '../model/contacts';
import { resolvePortalViewer, type PortalViewer } from '../model/identity';
import {
	PORTAL_RECORD_MAX,
	portalConnections,
	portalGiving,
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

		const record = await toPortalRecord(ctx, viewer, project, campaign, connection);
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

/**
 * Why this account has no portal, for the page that has to say so.
 *
 * `resolvePortalViewer` answers one bit — viewer or not — which is right for
 * every read but leaves the refusal page with four different situations and
 * one sentence to cover them: signed in as the wrong person, invited but not
 * yet claimed, access withdrawn, or never invited at all. They want different
 * words and different actions, so this names which one it is.
 *
 * THE ENUMERATION LINE. Every branch below is keyed on the caller's OWN
 * account — their user id, or the verified email their session already
 * carries. Telling someone "your address matches a record here" discloses
 * them to themselves and nobody else. Nothing here may ever take an address
 * as an argument: that would turn this into a "does this person give to you"
 * oracle for anyone who can sign up. The email lookup is the same one
 * `claimPortalContact` already performs on every load, so this adds no
 * surface that was not already reachable.
 *
 * Returned rather than thrown, and total rather than partial — `active` is
 * unreachable through the layout that calls this, but a query that answers
 * "you are fine" for a viewer is easier to reason about than one with a hole
 * in it.
 */
export const getPortalSituation = query({
	args: {},
	handler: async (ctx) => {
		const access = await getAccess(ctx);
		const user = await authComponent.safeGetAuthUser(ctx);
		const email = user?.email ?? null;

		if (!access.orgId || !access.userId) {
			return { state: 'unknown' as const, email, orgName: null };
		}

		const settings = await ctx.db
			.query('orgSettings')
			.withIndex('by_orgId', (q) => q.eq('orgId', access.orgId!))
			.unique();
		const orgName = settings?.publicName?.trim() || null;

		const linked = await ctx.db
			.query('contacts')
			.withIndex('by_orgId_and_authUserId', (q) =>
				q.eq('orgId', access.orgId!).eq('authUserId', access.userId!)
			)
			.unique();
		if (linked) {
			return {
				state: linked.portalAccess === 'revoked' ? ('revoked' as const) : ('active' as const),
				email,
				orgName
			};
		}

		// Revocation cuts the account link, so a revoked person is found by
		// address rather than by id — and only by their own.
		//
		// Which means `revoked` is only reachable when the contact's address
		// still matches the address they sign in with. For anyone who arrived
		// through an invitation that is the same address by construction. For a
		// contact linked some other way — a seed, a hand-run mutation — it is
		// not, and they fall through to `unknown`. That degrades to a vaguer
		// message and never to a wrong one, which is the right way round; the
		// alternative is keeping `authUserId` through a revocation, and cutting
		// that link is the entire point of revoking.
		const emailLower = normalizeEmail(email ?? undefined);
		if (emailLower) {
			const byEmail = await ctx.db
				.query('contacts')
				.withIndex('by_orgId_and_emailLower', (q) =>
					q.eq('orgId', access.orgId!).eq('emailLower', emailLower)
				)
				.unique();
			// A contact already linked to a DIFFERENT account is not this caller's
			// to hear about, so it falls through to `unknown` with everyone else.
			if (byEmail && byEmail.authUserId === undefined) {
				if (byEmail.portalAccess === 'revoked') {
					return { state: 'revoked' as const, email, orgName };
				}
				if (byEmail.portalAccess === 'invited') {
					return { state: 'invited' as const, email, orgName };
				}
			}
		}

		return { state: 'unknown' as const, email, orgName };
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
 * everything. Same shape the list returns, so a page cannot read one of them
 * correctly and the other not.
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
			.withIndex('by_orgId_and_number', (q) =>
				q.eq('orgId', viewer.orgId).eq('number', args.number)
			)
			.unique();
		if (!project) return null;

		const connections = await portalConnections(ctx, viewer);
		const connection = connections.get(project._id);
		if (!connection) return null;

		const campaign = await ctx.db.get('campaigns', project.campaignId);
		if (!campaign || campaign.orgId !== viewer.orgId) return null;

		return await toPortalRecord(ctx, viewer, project, campaign, connection);
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
