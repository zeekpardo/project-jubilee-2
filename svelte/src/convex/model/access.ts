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
