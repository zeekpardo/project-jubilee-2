import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { activeOrgId } from '../model/auth';

async function householdMembers(
	ctx: QueryCtx,
	householdId: Id<'households'>
): Promise<Doc<'householdMembers'>[]> {
	return await ctx.db
		.query('householdMembers')
		.withIndex('by_householdId', (q) => q.eq('householdId', householdId))
		.collect();
}

export const listHouseholds = query({
	args: {
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return [];
		}

		const rows = ctx.db.query('households').withIndex('by_orgId', (q) => q.eq('orgId', orgId));
		const households =
			args.limit === undefined ? await rows.collect() : await rows.take(args.limit);

		// memberCount is DERIVED from the link rows on every read, never stored, so
		// adding or removing a member can never leave a stale count behind.
		return await Promise.all(
			households.map(async (household) => ({
				...household,
				memberCount: (await householdMembers(ctx, household._id)).length
			}))
		);
	}
});

export const getHousehold = query({
	args: {
		householdId: v.id('households')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return null;
		}

		const household = await ctx.db.get('households', args.householdId);
		if (!household || household.orgId !== orgId) {
			return null;
		}

		const links = await householdMembers(ctx, household._id);
		const members = await Promise.all(
			links.map(async (link) => ({
				...link,
				contact: await ctx.db.get('contacts', link.contactId)
			}))
		);

		return { ...household, members, memberCount: members.length };
	}
});
