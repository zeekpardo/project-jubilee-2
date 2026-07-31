import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireOrgId } from '../model/auth';
import { deleteHouseholdCascade } from '../model/cascade';
import {
	assertHouseholdMemberUnique,
	householdRoleValidator,
	requireContact,
	requireHousehold
} from '../model/memberships';

async function requireHouseholdMember(
	ctx: MutationCtx,
	orgId: string,
	householdMemberId: Id<'householdMembers'>
): Promise<Doc<'householdMembers'>> {
	const member = await ctx.db.get('householdMembers', householdMemberId);
	if (!member || member.orgId !== orgId) {
		throw new ConvexError('Household member not found');
	}
	return member;
}

export const createHousehold = mutation({
	args: {
		name: v.string(),
		avatarUrl: v.optional(v.string()),
		primaryContactId: v.optional(v.id('contacts'))
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);

		if (args.primaryContactId !== undefined) {
			await requireContact(ctx, orgId, args.primaryContactId);
		}

		return await ctx.db.insert('households', { ...args, orgId });
	}
});

export const updateHousehold = mutation({
	args: {
		householdId: v.id('households'),
		name: v.optional(v.string()),
		avatarUrl: v.optional(v.string()),
		primaryContactId: v.optional(v.id('contacts'))
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireHousehold(ctx, orgId, args.householdId);

		if (args.primaryContactId !== undefined) {
			await requireContact(ctx, orgId, args.primaryContactId);
		}

		const { householdId, ...updates } = args;

		const patch: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(updates)) {
			if (value !== undefined) {
				patch[key] = value;
			}
		}

		await ctx.db.patch('households', householdId, patch as Partial<Doc<'households'>>);
		return householdId;
	}
});

// Drops the link rows only. The contacts are people in their own right and
// belong to other households, so they are never deleted here.
export const deleteHousehold = mutation({
	args: {
		householdId: v.id('households')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireHousehold(ctx, orgId, args.householdId);

		await deleteHouseholdCascade(ctx, args.householdId);
		return null;
	}
});

export const addHouseholdMember = mutation({
	args: {
		householdId: v.id('households'),
		contactId: v.id('contacts'),
		role: v.optional(householdRoleValidator),
		pending: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireHousehold(ctx, orgId, args.householdId);
		await requireContact(ctx, orgId, args.contactId);
		await assertHouseholdMemberUnique(ctx, args.householdId, args.contactId);

		return await ctx.db.insert('householdMembers', {
			orgId,
			householdId: args.householdId,
			contactId: args.contactId,
			role: args.role ?? 'adult',
			pending: args.pending ?? false
		});
	}
});

export const updateHouseholdMember = mutation({
	args: {
		householdMemberId: v.id('householdMembers'),
		role: v.optional(householdRoleValidator),
		pending: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const member = await requireHouseholdMember(ctx, orgId, args.householdMemberId);

		const patch: Partial<Omit<Doc<'householdMembers'>, '_id' | '_creationTime' | 'orgId'>> = {};
		if (args.role !== undefined) {
			patch.role = args.role;
		}
		if (args.pending !== undefined) {
			patch.pending = args.pending;
		}

		await ctx.db.patch('householdMembers', member._id, patch);
		return member._id;
	}
});

export const removeHouseholdMember = mutation({
	args: {
		householdMemberId: v.id('householdMembers')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const member = await requireHouseholdMember(ctx, orgId, args.householdMemberId);
		const household = await requireHousehold(ctx, orgId, member.householdId);

		// primaryContactId is CLEARED, never cascaded: the household survives
		// because other members may remain.
		if (household.primaryContactId === member.contactId) {
			await ctx.db.patch('households', household._id, { primaryContactId: undefined });
		}

		await ctx.db.delete('householdMembers', member._id);
		return null;
	}
});
