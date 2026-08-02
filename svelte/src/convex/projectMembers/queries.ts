import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAccess, readableOrgId } from '../model/access';
import { can } from '../../lib/domain/permissions';

export const listMembersForProject = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) {
			return [];
		}

		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== access.orgId) {
			return [];
		}
		// The joined rows carry the contact record, so this reads as a contacts
		// capability even though the argument is a project.
		if (!can(access, 'contacts:read', project.campaignId)) {
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
		const orgId = await readableOrgId(ctx, 'projects:read');
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
			links.map(async (link) => {
				const project = await ctx.db.get('projects', link.projectId);
				return {
					...link,
					// Only the fields CampaignsTab.svelte actually reads — not the
					// whole project document.
					project: project ? { number: project.number, name: project.name } : null
				};
			})
		);
	}
});
