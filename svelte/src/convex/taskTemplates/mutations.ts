import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { authComponent, createAuth } from '../auth';

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

// At most one active version per campaign, so activating one clears the rest.
async function deactivateOthers(
	ctx: MutationCtx,
	campaignId: Id<'campaigns'>,
	keepId: Id<'taskTemplates'> | null
): Promise<void> {
	const active = await ctx.db
		.query('taskTemplates')
		.withIndex('by_campaignId_and_isActive', (q) =>
			q.eq('campaignId', campaignId).eq('isActive', true)
		)
		.collect();
	for (const template of active) {
		if (template._id !== keepId) {
			await ctx.db.patch('taskTemplates', template._id, { isActive: false });
		}
	}
}

const itemsValidator = v.array(
	v.object({
		key: v.string(),
		label: v.string(),
		order: v.number(),
		impactTag: v.union(v.literal('business'), v.literal('school'), v.null())
	})
);

// Append-only: a checklist change is a new version row, never an edit of an
// existing one, so tasks keep the version they snapshotted.
export const createTaskTemplateVersion = mutation({
	args: {
		campaignId: v.id('campaigns'),
		version: v.string(),
		items: itemsValidator,
		effectiveFrom: v.optional(v.string()),
		activate: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			throw new ConvexError('Campaign not found');
		}

		const conflict = await ctx.db
			.query('taskTemplates')
			.withIndex('by_campaignId_and_version', (q) =>
				q.eq('campaignId', args.campaignId).eq('version', args.version)
			)
			.first();
		if (conflict) {
			throw new ConvexError('Task template version already exists for this campaign');
		}

		const keys = new Set<string>();
		for (const item of args.items) {
			if (keys.has(item.key)) {
				throw new ConvexError(`Duplicate task item key "${item.key}"`);
			}
			keys.add(item.key);
		}

		const activate = args.activate ?? false;
		if (activate) {
			await deactivateOthers(ctx, args.campaignId, null);
		}

		return await ctx.db.insert('taskTemplates', {
			orgId,
			campaignId: args.campaignId,
			version: args.version,
			effectiveFrom: args.effectiveFrom,
			isActive: activate,
			items: args.items
		});
	}
});

export const activateTaskTemplate = mutation({
	args: {
		taskTemplateId: v.id('taskTemplates')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);

		const template = await ctx.db.get('taskTemplates', args.taskTemplateId);
		if (!template || template.orgId !== orgId) {
			throw new ConvexError('Task template not found');
		}

		await deactivateOthers(ctx, template.campaignId, template._id);

		if (!template.isActive) {
			await ctx.db.patch('taskTemplates', template._id, { isActive: true });
		}

		return template._id;
	}
});
