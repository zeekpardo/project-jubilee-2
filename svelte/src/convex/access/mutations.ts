import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import { getAccess, requireCapability } from '../model/access';
import { assignableRoles, isRole } from '../../lib/domain/permissions';

/** Assign a team leader to a campaign. */
export const assignCampaign = mutation({
	args: { userId: v.string(), campaignId: v.id('campaigns') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'members:manage');

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			throw new ConvexError('Campaign not found');
		}

		const existing = await ctx.db
			.query('campaignAssignments')
			.withIndex('by_orgId_and_userId_and_campaignId', (q) =>
				q.eq('orgId', orgId).eq('userId', args.userId).eq('campaignId', args.campaignId)
			)
			.first();
		if (existing) return existing._id;

		return await ctx.db.insert('campaignAssignments', {
			orgId,
			userId: args.userId,
			campaignId: args.campaignId
		});
	}
});

export const unassignCampaign = mutation({
	args: { userId: v.string(), campaignId: v.id('campaigns') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'members:manage');

		const existing = await ctx.db
			.query('campaignAssignments')
			.withIndex('by_orgId_and_userId_and_campaignId', (q) =>
				q.eq('orgId', orgId).eq('userId', args.userId).eq('campaignId', args.campaignId)
			)
			.first();
		if (existing) await ctx.db.delete('campaignAssignments', existing._id);
		return null;
	}
});

/**
 * Replace a member's campaign assignments in one write, scoped to this org so
 * assignments made elsewhere are untouched.
 */
export const setCampaignAssignments = mutation({
	args: { userId: v.string(), campaignIds: v.array(v.id('campaigns')) },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'members:manage');

		for (const campaignId of args.campaignIds) {
			const campaign = await ctx.db.get('campaigns', campaignId);
			if (!campaign || campaign.orgId !== orgId) {
				throw new ConvexError('Campaign not found');
			}
		}

		const current = await ctx.db
			.query('campaignAssignments')
			.withIndex('by_orgId_and_userId', (q) => q.eq('orgId', orgId).eq('userId', args.userId))
			.collect();
		for (const row of current) {
			await ctx.db.delete('campaignAssignments', row._id);
		}

		for (const campaignId of args.campaignIds) {
			await ctx.db.insert('campaignAssignments', { orgId, userId: args.userId, campaignId });
		}
		return args.campaignIds.length;
	}
});

/**
 * Change a member's role. Guarded by assignableRoles so an admin can never
 * promote anyone — including themselves — to owner or admin.
 */
export const setMemberRole = mutation({
	args: { memberId: v.string(), role: v.string() },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) throw new ConvexError('Not authenticated');
		if (!isRole(args.role)) throw new ConvexError(`Unknown role: ${args.role}`);

		const allowed = assignableRoles(access.role);
		if (!allowed.includes(args.role)) {
			throw new ConvexError(`Not permitted to assign role: ${args.role}`);
		}

		// Better Auth owns the member record; this mutation only authorises the
		// change. The caller performs it through the auth client.
		return { memberId: args.memberId, role: args.role, authorized: true };
	}
});
