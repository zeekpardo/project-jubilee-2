/**
 * Give a dev deployment one portal member to look at.
 *
 * The seeded data has no portal identity in it, and it cannot have one: a
 * portal member is half a contact row and half a Better Auth account, and the
 * account half belongs to whoever is sitting at the machine. So this takes an
 * EXISTING account id and binds it to an existing contact rather than
 * conjuring a login — nothing here creates a user, sets a password, or sends
 * mail.
 *
 * Binding your own staff account is the intended use, and it is now the ONLY
 * way a staff member reaches their own pages. `resolvePortalViewer` used to let
 * staff through without a contact row; it is gone, and `resolveSiteViewer`
 * grants no such exemption — the org there comes from the URL while a role
 * comes from the session, and asking org A's role about org B's page is exactly
 * the confusion that resolver exists to prevent. So an owner who wants to see a
 * real donor view at `/{orgSlug}/me` runs this first. Without it they have no
 * record at that org and are redirected to its public home, the same as anyone
 * else — which is the point, not a regression.
 *
 * WHAT IT TOUCHES, and why each is reversible by `clearPortalMember`:
 *   - the contact: authUserId, portalAccess, invitedAt
 *   - donations that carry NO contactId: given one, so giving and the records
 *     it supports have something in them. Attribution only — no amount, no
 *     allocation and no total is changed, so the seed's money assertions still
 *     hold.
 *   - a few open tasks on connected records: assigned to the contact, so the
 *     tasks surface is not empty.
 *
 * Dev only. Internal mutations, called from the CLI:
 *
 *   npx convex run seed/portal:seedPortalMember '{"orgId":"...","authUserId":"..."}'
 *   npx convex run seed/portal:clearPortalMember '{"orgId":"..."}'
 */
import { ConvexError, v } from 'convex/values';
import { internalMutation } from '../functions';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { contactDisplayName } from '../../lib/features/contacts/contact-name';

/** Bounded reads: this is a dev helper, not a production path. */
const SCAN_MAX = 1000;

/** Enough giving to see a list and a total, few enough to stay obviously seeded. */
const DEFAULT_GIFTS = 3;

/** Enough tasks to see the list, the sort and the empty-state boundary. */
const DEFAULT_TASKS = 3;

/**
 * The contact to bind when none is named: whoever sponsors the most records.
 * A sponsor with several records exercises the interesting half of the portal
 * — connections that filter public cards — where a contact with none would
 * show a working page with nothing on it and prove very little.
 */
async function bestPortalCandidate(
	ctx: MutationCtx,
	orgId: string
): Promise<Doc<'contacts'> | null> {
	const links = await ctx.db.query('projectMembers').take(SCAN_MAX);

	const byContact = new Map<Id<'contacts'>, number>();
	for (const link of links) {
		if (link.orgId !== orgId) continue;
		byContact.set(link.contactId, (byContact.get(link.contactId) ?? 0) + 1);
	}

	let best: { contactId: Id<'contacts'>; count: number } | null = null;
	for (const [contactId, count] of byContact) {
		if (!best || count > best.count) best = { contactId, count };
	}
	if (!best) return null;

	return await ctx.db.get('contacts', best.contactId);
}

export const seedPortalMember = internalMutation({
	args: {
		orgId: v.string(),
		/** A Better Auth user id. `npx convex data --component betterAuth user` lists them. */
		authUserId: v.string(),
		contactId: v.optional(v.id('contacts')),
		gifts: v.optional(v.number()),
		tasks: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const contact = args.contactId
			? await ctx.db.get('contacts', args.contactId)
			: await bestPortalCandidate(ctx, args.orgId);
		if (!contact || contact.orgId !== args.orgId) {
			throw new ConvexError('No contact to bind. Seed the org first, or pass a contactId.');
		}

		// One contact per account per org is a schema invariant, so a second run
		// against a different contact has to be told what to do rather than
		// guessing. clearPortalMember is that answer.
		const alreadyBound = await ctx.db
			.query('contacts')
			.withIndex('by_orgId_and_authUserId', (q) =>
				q.eq('orgId', args.orgId).eq('authUserId', args.authUserId)
			)
			.unique();
		if (alreadyBound && alreadyBound._id !== contact._id) {
			throw new ConvexError(
				`That account is already bound to ${contactDisplayName(alreadyBound)}. Run seed/portal:clearPortalMember first.`
			);
		}

		await ctx.db.patch('contacts', contact._id, {
			authUserId: args.authUserId,
			portalAccess: 'active',
			invitedAt: contact.invitedAt ?? Date.now()
		});

		// --- Giving -----------------------------------------------------------
		// Only donations nobody is credited with, and project-allocated ones
		// first: those are what turn into supported records on the portal.
		const wanted = args.gifts ?? DEFAULT_GIFTS;
		const donations = await ctx.db
			.query('transactions')
			.withIndex('by_orgId_and_type', (q) => q.eq('orgId', args.orgId).eq('type', 'donation'))
			.take(SCAN_MAX);

		const unattributed = donations.filter((donation) => donation.contactId === undefined);
		const scored: { donation: Doc<'transactions'>; toProject: boolean }[] = [];
		for (const donation of unattributed) {
			const allocations = await ctx.db
				.query('allocations')
				.withIndex('by_transactionId', (q) => q.eq('transactionId', donation._id))
				.collect();
			scored.push({
				donation,
				toProject: allocations.some((allocation) => allocation.projectId !== undefined)
			});
		}
		scored.sort((a, b) => Number(b.toProject) - Number(a.toProject));

		let gifts = 0;
		for (const { donation } of scored.slice(0, Math.max(0, wanted))) {
			await ctx.db.patch('transactions', donation._id, { contactId: contact._id });
			gifts += 1;
		}

		// --- Tasks ------------------------------------------------------------
		// Open tasks only, on records this person is already connected to, so the
		// portal's task list agrees with its records list.
		const connected = new Set<Id<'projects'>>();
		const memberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_contactId', (q) => q.eq('contactId', contact._id))
			.take(SCAN_MAX);
		for (const membership of memberships) {
			if (membership.orgId === args.orgId) connected.add(membership.projectId);
		}

		const openTasks = await ctx.db
			.query('tasks')
			.withIndex('by_orgId_and_status', (q) => q.eq('orgId', args.orgId).eq('status', 'todo'))
			.take(SCAN_MAX);

		let assigned = 0;
		const wantedTasks = args.tasks ?? DEFAULT_TASKS;
		for (const task of openTasks) {
			if (assigned >= wantedTasks) break;
			if (task.assignee !== undefined) continue;
			if (!task.projectId || !connected.has(task.projectId)) continue;
			await ctx.db.patch('tasks', task._id, {
				assignee: { kind: 'contact', contactId: contact._id }
			});
			assigned += 1;
		}

		return {
			contactId: contact._id,
			name: contactDisplayName(contact),
			records: connected.size,
			gifts,
			tasks: assigned
		};
	}
});

/**
 * Undo it. Named without a contactId so the usual case — "put dev back" — is
 * one command; the bound contact is found by the account link itself.
 */
export const clearPortalMember = internalMutation({
	args: {
		orgId: v.string(),
		authUserId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const contacts = await ctx.db
			.query('contacts')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.take(SCAN_MAX);

		const bound = contacts.filter(
			(contact) =>
				contact.authUserId !== undefined &&
				(args.authUserId === undefined || contact.authUserId === args.authUserId)
		);

		let gifts = 0;
		let tasks = 0;
		for (const contact of bound) {
			const donations = await ctx.db
				.query('transactions')
				.withIndex('by_contactId', (q) => q.eq('contactId', contact._id))
				.take(SCAN_MAX);
			for (const donation of donations) {
				await ctx.db.patch('transactions', donation._id, { contactId: undefined });
				gifts += 1;
			}

			const open = await ctx.db
				.query('tasks')
				.withIndex('by_orgId_and_status', (q) => q.eq('orgId', args.orgId).eq('status', 'todo'))
				.take(SCAN_MAX);
			for (const task of open) {
				if (task.assignee?.kind !== 'contact' || task.assignee.contactId !== contact._id) continue;
				await ctx.db.patch('tasks', task._id, { assignee: undefined });
				tasks += 1;
			}

			await ctx.db.patch('contacts', contact._id, {
				authUserId: undefined,
				portalAccess: undefined,
				invitedAt: undefined
			});
		}

		return { contacts: bound.length, gifts, tasks };
	}
});
