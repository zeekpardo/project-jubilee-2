import { v } from 'convex/values';
import { query } from '../_generated/server';
import { activeOrgId } from '../model/auth';

export const listDocumentsForProject = query({
	args: {
		projectId: v.id('projects'),
		stage: v.optional(v.string())
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
		const projectId = args.projectId;

		if (args.stage !== undefined) {
			const stage = args.stage;
			return await ctx.db
				.query('documents')
				.withIndex('by_projectId_and_stage', (q) => q.eq('projectId', projectId).eq('stage', stage))
				.collect();
		}

		return await ctx.db
			.query('documents')
			.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
			.collect();
	}
});

export const getDocument = query({
	args: {
		documentId: v.id('documents')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return null;
		}

		const document = await ctx.db.get('documents', args.documentId);
		if (!document || document.orgId !== orgId) {
			return null;
		}

		// Storage URLs are signed and expire, so they are generated per read
		// rather than stored alongside the row.
		const fileUrl =
			document.storageId === undefined ? null : await ctx.storage.getUrl(document.storageId);

		return { ...document, fileUrl };
	}
});
