// ============================================================
// Who is asking, and may they
// ============================================================
// Every Convex function that touches org data starts here. There are three
// entry points and the difference between them is what happens when the answer
// is no:
//
//   getAccess        — tells you, decides nothing. For handlers that need the
//                      role or the assigned campaigns to shape a result.
//   readableOrgId    — a query's gate. Returns null when the caller may not
//                      read, so the handler returns empty rather than throwing.
//                      A list the viewer cannot see is an empty list, not an
//                      error dialog.
//   requireCapability — a mutation's gate. Throws, because a write that is not
//                      permitted must fail loudly.
//
// CAMPAIGN SCOPE. Some capabilities are campaign-scoped (see `permissions.ts`).
// Passing no campaignId asks "anywhere at all", which is the right question for
// a nav item or an org-wide list and the WRONG one for a write to a particular
// record. Where the campaign is only knowable after the row is loaded — most
// updates and deletes — gate twice: once org-wide to establish the caller, then
// again with `row.campaignId` once you have it. `tasks/mutations.ts` is the
// worked example.
//
// Rows with no campaign of their own — contacts, households, transactions —
// are org-wide by nature, so they gate once with no campaignId. A team leader
// assigned to any campaign may read them; that is the matrix's own answer, not
// a shortcut taken here.
// ============================================================

import { ConvexError } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { authComponent, createAuth } from '../auth';
import { can, isRole, type Access, type Capability } from '../../lib/domain/permissions';

/**
 * The caller's role and campaign assignments. Returns a null role when there
 * is no session or no active organization, so a query can degrade to empty
 * rather than throwing.
 */
export async function getAccess(
	ctx: QueryCtx
): Promise<Access & { orgId: string | null; userId: string | null }> {
	const empty = { role: null, assignedCampaignIds: [], orgId: null, userId: null };

	const user = await authComponent.safeGetAuthUser(ctx);
	if (!user) return empty;

	let orgId: string | null = null;
	let rawRole: string | null;
	try {
		const auth = createAuth(ctx);
		const headers = await authComponent.getHeaders(ctx);
		const organization = await auth.api.getFullOrganization({ headers });
		if (!organization) return empty;
		orgId = organization.id;

		const member = await auth.api.getActiveMember({ headers });
		rawRole = member?.role ?? null;
	} catch {
		return empty;
	}

	// Better Auth seeds the creator as 'owner'. Anything it does not recognise
	// is treated as no access rather than being guessed at.
	const role = isRole(rawRole) ? rawRole : null;

	const assignments = await ctx.db
		.query('campaignAssignments')
		.withIndex('by_orgId_and_userId', (q) => q.eq('orgId', orgId!).eq('userId', user._id))
		.collect();

	return {
		role,
		assignedCampaignIds: assignments.map((a) => a.campaignId as string),
		orgId,
		userId: user._id
	};
}

/**
 * A query's gate: the caller's org id when they may read this here, else null.
 *
 * Returning null rather than throwing is deliberate — a query runs on every
 * subscription tick, and a viewer who lost a capability should see the surface
 * empty out, not fill with errors. The handler's guard clause becomes the same
 * one line it had when the gate was `activeOrgId`.
 */
export async function readableOrgId(
	ctx: QueryCtx,
	capability: Capability,
	campaignId?: Id<'campaigns'> | string | null
): Promise<string | null> {
	const access = await getAccess(ctx);
	if (!access.orgId) return null;
	if (!can(access, capability, campaignId ?? null)) return null;
	return access.orgId;
}

/** Throws unless the caller holds the capability, here. */
export async function requireCapability(
	ctx: MutationCtx,
	capability: Capability,
	campaignId?: Id<'campaigns'> | null
): Promise<{ orgId: string; userId: string; access: Access }> {
	const access = await getAccess(ctx);
	if (!access.orgId || !access.userId) {
		throw new ConvexError('Not authenticated');
	}
	if (!can(access, capability, campaignId ?? null)) {
		throw new ConvexError(`Not permitted: ${capability}`);
	}
	return { orgId: access.orgId, userId: access.userId, access };
}
