import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAccess } from '../model/access';
import { visibleCampaignIds } from '../../lib/domain/permissions';

/**
 * The caller's role and assignments. The whole admin UI gates on this one
 * query, so nav, buttons and route guards all agree.
 */
export const getMyAccess = query({
	args: {},
	handler: async (ctx) => {
		const access = await getAccess(ctx);
		return {
			role: access.role,
			assignedCampaignIds: access.assignedCampaignIds,
			userId: access.userId
		};
	}
});

/** Campaigns the caller may actually work in. */
export const listMyCampaigns = query({
	args: {},
	handler: async (ctx) => {
		const access = await getAccess(ctx);
		if (!access.orgId || !access.role) return [];

		const campaigns = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId', (q) => q.eq('orgId', access.orgId!))
			.collect();

		const allowed = new Set(
			visibleCampaignIds(
				access,
				campaigns.map((c) => c._id as string)
			)
		);
		return campaigns.filter((c) => allowed.has(c._id as string));
	}
});

/** Every member of the org with their role and campaign assignments. */
export const listMembers = query({
	args: {},
	handler: async (ctx) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return [];
		if (access.role !== 'owner' && access.role !== 'admin') return [];

		const assignments = await ctx.db
			.query('campaignAssignments')
			.withIndex('by_orgId_and_userId', (q) => q.eq('orgId', access.orgId!))
			.collect();

		const byUser = new Map<string, string[]>();
		for (const assignment of assignments) {
			const list = byUser.get(assignment.userId) ?? [];
			list.push(assignment.campaignId as string);
			byUser.set(assignment.userId, list);
		}

		return [...byUser.entries()].map(([userId, campaignIds]) => ({ userId, campaignIds }));
	}
});

/** Campaign assignments for one member. */
export const listAssignmentsForUser = query({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return [];
		if (access.role !== 'owner' && access.role !== 'admin' && access.userId !== args.userId) {
			return [];
		}

		const assignments = await ctx.db
			.query('campaignAssignments')
			.withIndex('by_orgId_and_userId', (q) =>
				q.eq('orgId', access.orgId!).eq('userId', args.userId)
			)
			.collect();

		return assignments.map((a) => a.campaignId);
	}
});
