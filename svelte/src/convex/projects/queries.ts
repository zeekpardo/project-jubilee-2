import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { getAccess, readableOrgId } from '../model/access';
import { can } from '../../lib/domain/permissions';

/**
 * An uploaded photo is reachable only through a signed URL, and a list consumer
 * (the gallery card) receives plain rows — it has no way to turn a storage id
 * into something an <img> can load. So the id is resolved here. A pasted
 * `photoUrl` is already a URL and passes through untouched; it is also the
 * fallback if signing ever fails.
 */
async function withPhotoUrls(ctx: QueryCtx, rows: Doc<'projects'>[]): Promise<Doc<'projects'>[]> {
	return await Promise.all(
		rows.map(async (row) =>
			row.photoStorageId
				? { ...row, photoUrl: (await ctx.storage.getUrl(row.photoStorageId)) ?? row.photoUrl }
				: row
		)
	);
}

export const listProjects = query({
	args: {
		campaignId: v.optional(v.id('campaigns')),
		stage: v.optional(v.string()),
		isPublished: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'projects:read', args.campaignId);
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
			return await withPhotoUrls(ctx, rows);
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
			return await withPhotoUrls(
				ctx,
				args.isPublished === undefined
					? rows
					: rows.filter((row) => row.isPublished === args.isPublished)
			);
		}

		if (args.isPublished !== undefined) {
			const isPublished = args.isPublished;
			return await withPhotoUrls(
				ctx,
				await ctx.db
					.query('projects')
					.withIndex('by_campaignId_and_isPublished', (q) =>
						q.eq('campaignId', campaignId).eq('isPublished', isPublished)
					)
					.collect()
			);
		}

		return await withPhotoUrls(
			ctx,
			await ctx.db
				.query('projects')
				.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
				.collect()
		);
	}
});

export const getProject = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) {
			return null;
		}

		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== access.orgId) {
			return null;
		}
		if (!can(access, 'projects:read', project.campaignId)) {
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
		const access = await getAccess(ctx);
		if (!access.orgId) {
			return null;
		}
		const orgId = access.orgId;

		const project = await ctx.db
			.query('projects')
			.withIndex('by_orgId_and_number', (q) => q.eq('orgId', orgId).eq('number', args.number))
			.unique();
		if (!project) {
			return null;
		}
		if (!can(access, 'projects:read', project.campaignId)) {
			return null;
		}

		return project;
	}
});
