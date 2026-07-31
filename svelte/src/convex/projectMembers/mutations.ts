import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireOrgId } from '../model/auth';
import {
	assertMemberAttributes,
	assertProjectMemberUnique,
	memberAttributesValidator,
	projectMemberRoleValidator,
	requireContact,
	requireProject
} from '../model/memberships';

async function requireProjectMember(
	ctx: MutationCtx,
	orgId: string,
	projectMemberId: Id<'projectMembers'>
): Promise<Doc<'projectMembers'>> {
	const member = await ctx.db.get('projectMembers', projectMemberId);
	if (!member || member.orgId !== orgId) {
		throw new ConvexError('Project member not found');
	}
	return member;
}

export const addProjectMember = mutation({
	args: {
		projectId: v.id('projects'),
		contactId: v.id('contacts'),
		role: v.optional(projectMemberRoleValidator),
		attributes: v.optional(memberAttributesValidator)
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireProject(ctx, orgId, args.projectId);
		await requireContact(ctx, orgId, args.contactId);
		await assertProjectMemberUnique(ctx, args.projectId, args.contactId);
		assertMemberAttributes(args.attributes);

		return await ctx.db.insert('projectMembers', {
			orgId,
			projectId: args.projectId,
			contactId: args.contactId,
			role: args.role ?? 'member',
			attributes: args.attributes ?? {}
		});
	}
});

// projectId and contactId are deliberately absent — re-pointing a link would
// change the pair the uniqueness index guards. Remove and re-add instead.
export const updateProjectMember = mutation({
	args: {
		projectMemberId: v.id('projectMembers'),
		role: v.optional(projectMemberRoleValidator),
		attributes: v.optional(memberAttributesValidator)
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const member = await requireProjectMember(ctx, orgId, args.projectMemberId);
		assertMemberAttributes(args.attributes);

		const patch: Partial<Omit<Doc<'projectMembers'>, '_id' | '_creationTime' | 'orgId'>> = {};
		if (args.role !== undefined) {
			patch.role = args.role;
		}
		if (args.attributes !== undefined) {
			patch.attributes = args.attributes;
		}

		await ctx.db.patch('projectMembers', member._id, patch);
		return member._id;
	}
});

// Drops the link only. The contact is campaign-agnostic and survives.
export const removeProjectMember = mutation({
	args: {
		projectMemberId: v.id('projectMembers')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const member = await requireProjectMember(ctx, orgId, args.projectMemberId);

		await ctx.db.delete('projectMembers', member._id);
		return null;
	}
});
