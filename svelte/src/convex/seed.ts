import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { createCampaignModel } from './model/campaigns';

/**
 * Bootstraps an org's settings and its first campaign. Internal-only and
 * takes an explicit orgId so the backend can be exercised from the CLI
 * (`npx convex run seed:seedCampaign '{"orgId":"..."}'`) before any UI exists.
 *
 * Contains no real data — names and copy here are placeholders.
 */
export const seedCampaign = internalMutation({
	args: {
		orgId: v.string(),
		name: v.optional(v.string()),
		slug: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const existingSettings = await ctx.db
			.query('orgSettings')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.first();
		if (!existingSettings) {
			await ctx.db.insert('orgSettings', {
				orgId: args.orgId,
				campaignLabel: 'Campaign',
				campaignLabelPlural: 'Campaigns'
			});
		}

		const campaignId = await createCampaignModel(ctx, {
			orgId: args.orgId,
			name: args.name ?? 'Project Jubilee',
			slug: args.slug ?? 'project-jubilee',
			objectLabel: 'Family',
			objectLabelPlural: 'Families',
			goalLabel: 'Freed',
			goalVerb: 'freed',
			numberPrefix: 'P',
			membersEnabled: true,
			budgetShape: 'template'
		});

		return campaignId;
	}
});

/** Removes every app-table row for an org. Dev convenience for reseeding. */
export const resetOrg = internalMutation({
	args: { orgId: v.string() },
	handler: async (ctx, args) => {
		const campaigns = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.collect();

		for (const campaign of campaigns) {
			const stages = await ctx.db
				.query('pipelineStages')
				.withIndex('by_campaignId_and_order', (q) => q.eq('campaignId', campaign._id))
				.collect();
			for (const stage of stages) {
				await ctx.db.delete(stage._id);
			}

			const costs = await ctx.db
				.query('costTemplates')
				.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
				.collect();
			for (const cost of costs) {
				await ctx.db.delete(cost._id);
			}

			const tasks = await ctx.db
				.query('taskTemplates')
				.withIndex('by_campaignId_and_version', (q) => q.eq('campaignId', campaign._id))
				.collect();
			for (const task of tasks) {
				await ctx.db.delete(task._id);
			}

			await ctx.db.delete(campaign._id);
		}

		const settings = await ctx.db
			.query('orgSettings')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.collect();
		for (const row of settings) {
			await ctx.db.delete(row._id);
		}

		return { deletedCampaigns: campaigns.length };
	}
});
