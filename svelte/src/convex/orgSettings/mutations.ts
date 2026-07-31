import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
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

export const upsertOrgSettings = mutation({
	args: {
		campaignLabel: v.optional(v.string()),
		campaignLabelPlural: v.optional(v.string()),
		slug: v.optional(v.string()),
		theme: v.optional(v.string()),
		publicName: v.optional(v.string()),
		publicTagline: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);

		const existing = await ctx.db
			.query('orgSettings')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.unique();

		if (args.slug !== undefined && args.slug !== existing?.slug) {
			const slug = args.slug;
			const conflict = await ctx.db
				.query('orgSettings')
				.withIndex('by_slug', (q) => q.eq('slug', slug))
				.first();
			if (conflict) {
				throw new ConvexError('Slug already in use');
			}
		}

		if (!existing) {
			return await ctx.db.insert('orgSettings', {
				orgId,
				campaignLabel: args.campaignLabel ?? 'Campaign',
				campaignLabelPlural: args.campaignLabelPlural ?? 'Campaigns',
				slug: args.slug,
				theme: args.theme,
				publicName: args.publicName,
				publicTagline: args.publicTagline
			});
		}

		const patch: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(args)) {
			if (value !== undefined) {
				patch[key] = value;
			}
		}

		await ctx.db.patch('orgSettings', existing._id, patch as Partial<Doc<'orgSettings'>>);
		return existing._id;
	}
});
