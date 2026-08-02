import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { requireOrgId } from '../model/auth';

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

/**
 * Which campaigns' stats the org's own public page surfaces, and in what
 * order. Each becomes its own section reusing that campaign's `publicStats` —
 * nothing is summed across campaigns, because adding "families freed" to
 * "attendees reached" produces a number that means nothing.
 *
 * Replaces the whole list, same reasoning as setPublicStats: reordering is the
 * common edit.
 */
export const setPublicStatSections = mutation({
	args: {
		sections: v.array(
			v.object({
				campaignId: v.id('campaigns'),
				heading: v.optional(v.string()),
				order: v.number()
			})
		)
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);

		const seen = new Set<string>();
		for (const section of args.sections) {
			// Ownership is checked at write time as well as at read time: a
			// section naming another org's campaign must never be storable, not
			// merely unrenderable.
			const campaign = await ctx.db.get('campaigns', section.campaignId);
			if (!campaign || campaign.orgId !== orgId) {
				throw new ConvexError('Campaign not found');
			}
			if (seen.has(section.campaignId)) {
				throw new ConvexError('That campaign is already a section');
			}
			seen.add(section.campaignId);
		}

		const existing = await ctx.db
			.query('orgSettings')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.unique();

		const ordered = [...args.sections]
			.sort((a, b) => a.order - b.order)
			.map((section, index) => ({
				campaignId: section.campaignId,
				heading: section.heading?.trim() || undefined,
				order: index
			}));

		if (!existing) {
			return await ctx.db.insert('orgSettings', {
				orgId,
				campaignLabel: 'Campaign',
				campaignLabelPlural: 'Campaigns',
				publicStatSections: ordered
			});
		}

		await ctx.db.patch('orgSettings', existing._id, { publicStatSections: ordered });
		return existing._id;
	}
});
