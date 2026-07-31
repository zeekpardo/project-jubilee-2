import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { authComponent, createAuth } from '../auth';
import { canSetStage } from '../../lib/domain/stages';
import { campaignStages, createProjectModel } from '../model/projects';

async function requireOrgId(ctx: MutationCtx): Promise<string> {
	const user = await authComponent.safeGetAuthUser(ctx);
	if (!user) {
		throw new ConvexError('Not authenticated');
	}

	const auth = createAuth(ctx);
	const organization = await auth.api.getFullOrganization({
		headers: await authComponent.getHeaders(ctx)
	});
	if (!organization) {
		throw new ConvexError('No active organization');
	}

	return organization.id;
}

async function requireProject(
	ctx: MutationCtx,
	orgId: string,
	projectId: Id<'projects'>
): Promise<Doc<'projects'>> {
	const project = await ctx.db.get('projects', projectId);
	if (!project || project.orgId !== orgId) {
		throw new ConvexError('Project not found');
	}
	return project;
}

const attributesValidator = v.record(
	v.string(),
	v.union(v.string(), v.number(), v.boolean(), v.null())
);

export const createProject = mutation({
	args: {
		campaignId: v.id('campaigns'),
		name: v.string(),
		number: v.optional(v.string()),
		stage: v.optional(v.string()),
		story: v.optional(v.string()),
		attributes: v.optional(attributesValidator),
		note: v.optional(v.string()),
		managedMissionsLink: v.optional(v.string()),
		whatsappPhone: v.optional(v.string()),
		siteRef: v.optional(v.string()),
		photoUrl: v.optional(v.string()),
		videoUrl: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		return await createProjectModel(ctx, { ...args, orgId });
	}
});

// campaignId is deliberately absent — a project does not move between campaigns.
// stage, isPublished and isGoalMet have their own mutations so their side
// effects (validation, timestamps) can never be bypassed.
export const updateProject = mutation({
	args: {
		projectId: v.id('projects'),
		name: v.optional(v.string()),
		number: v.optional(v.string()),
		story: v.optional(v.string()),
		attributes: v.optional(attributesValidator),
		note: v.optional(v.string()),
		managedMissionsLink: v.optional(v.string()),
		whatsappPhone: v.optional(v.string()),
		siteRef: v.optional(v.string()),
		photoUrl: v.optional(v.string()),
		videoUrl: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const project = await requireProject(ctx, orgId, args.projectId);

		const { projectId, ...updates } = args;

		if (updates.number !== undefined && updates.number !== project.number) {
			const conflict = await ctx.db
				.query('projects')
				.withIndex('by_orgId_and_number', (q) => q.eq('orgId', orgId).eq('number', updates.number!))
				.first();
			if (conflict) {
				throw new ConvexError('Project number already in use');
			}
		}

		const patch: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(updates)) {
			if (value !== undefined) {
				patch[key] = value;
			}
		}

		await ctx.db.patch('projects', projectId, patch as Partial<Doc<'projects'>>);
		return projectId;
	}
});

export const setProjectStage = mutation({
	args: {
		projectId: v.id('projects'),
		stage: v.string()
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const project = await requireProject(ctx, orgId, args.projectId);

		const stages = await campaignStages(ctx, project.campaignId);
		const result = canSetStage(
			project.stage,
			args.stage,
			stages.map((stage) => stage.key)
		);
		if (!result.allowed) {
			throw new ConvexError(result.reason ?? 'Cannot set stage');
		}

		await ctx.db.patch('projects', args.projectId, { stage: args.stage });
		return args.projectId;
	}
});

export const setProjectPublished = mutation({
	args: {
		projectId: v.id('projects'),
		isPublished: v.boolean()
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const project = await requireProject(ctx, orgId, args.projectId);

		// publishedAt records the first publish and is never cleared afterwards.
		const patch: Partial<Doc<'projects'>> = { isPublished: args.isPublished };
		if (args.isPublished && project.publishedAt === undefined) {
			patch.publishedAt = Date.now();
		}

		await ctx.db.patch('projects', args.projectId, patch);
		return args.projectId;
	}
});

export const setProjectGoalMet = mutation({
	args: {
		projectId: v.id('projects'),
		isGoalMet: v.boolean()
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const project = await requireProject(ctx, orgId, args.projectId);

		await ctx.db.patch('projects', args.projectId, {
			isGoalMet: args.isGoalMet,
			goalMetAt: args.isGoalMet ? (project.goalMetAt ?? Date.now()) : undefined
		});
		return args.projectId;
	}
});

export const deleteProject = mutation({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireProject(ctx, orgId, args.projectId);

		await ctx.db.delete('projects', args.projectId);
		return null;
	}
});
