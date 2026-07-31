import { v } from 'convex/values';
import { query } from '../_generated/server';
import { activeOrgId } from '../model/auth';

export const listMembersForProject = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return [];
		}

		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== orgId) {
			return [];
		}

		const links = await ctx.db
			.query('projectMembers')
			.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
			.collect();

		return await Promise.all(
			links.map(async (link) => ({
				...link,
				contact: await ctx.db.get('contacts', link.contactId)
			}))
		);
	}
});

export const listProjectsForContact = query({
	args: {
		contactId: v.id('contacts')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return [];
		}

		const contact = await ctx.db.get('contacts', args.contactId);
		if (!contact || contact.orgId !== orgId) {
			return [];
		}

		const links = await ctx.db
			.query('projectMembers')
			.withIndex('by_contactId', (q) => q.eq('contactId', contact._id))
			.collect();

		return await Promise.all(
			links.map(async (link) => ({
				...link,
				project: await ctx.db.get('projects', link.projectId)
			}))
		);
	}
});
