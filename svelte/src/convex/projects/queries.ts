import { v } from 'convex/values';
import { query } from '../_generated/server';
import { activeOrgId } from '../model/auth';

export const listProjects = query({
	args: {
		campaignId: v.optional(v.id('campaigns')),
		stage: v.optional(v.string()),
		isPublished: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return [];
		}

		if (args.campaignId === undefined) {
			// No campaign-scoped index applies; by_orgId_and_number's leading
			// field still bounds the scan to this org.
			let rows = await ctx.db
				.query('projects')
				.withIndex('by_orgId_and_number', (q) => q.eq('orgId', orgId))
				.collect();
			if (args.stage !== undefined) {
				rows = rows.filter((row) => row.stage === args.stage);
			}
			if (args.isPublished !== undefined) {
				rows = rows.filter((row) => row.isPublished === args.isPublished);
			}
			return rows;
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return [];
		}
		const campaignId = args.campaignId;

		if (args.stage !== undefined) {
			const stage = args.stage;
			const rows = await ctx.db
				.query('projects')
				.withIndex('by_campaignId_and_stage', (q) =>
					q.eq('campaignId', campaignId).eq('stage', stage)
				)
				.collect();
			return args.isPublished === undefined
				? rows
				: rows.filter((row) => row.isPublished === args.isPublished);
		}

		if (args.isPublished !== undefined) {
			const isPublished = args.isPublished;
			return await ctx.db
				.query('projects')
				.withIndex('by_campaignId_and_isPublished', (q) =>
					q.eq('campaignId', campaignId).eq('isPublished', isPublished)
				)
				.collect();
		}

		return await ctx.db
			.query('projects')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
			.collect();
	}
});

export const getProject = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return null;
		}

		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== orgId) {
			return null;
		}

		return project;
	}
});

export const getProjectByNumber = query({
	args: {
		number: v.string()
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return null;
		}

		return await ctx.db
			.query('projects')
			.withIndex('by_orgId_and_number', (q) => q.eq('orgId', orgId).eq('number', args.number))
			.unique();
	}
});
