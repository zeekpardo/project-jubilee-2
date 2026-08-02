import { v } from 'convex/values';
import { query } from '../_generated/server';
import { activeOrgId } from '../model/auth';

export const listTaskTemplates = query({
	args: {
		campaignId: v.id('campaigns')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return [];
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return [];
		}

		return await ctx.db
			.query('taskTemplates')
			.withIndex('by_campaignId_and_isActive', (q) => q.eq('campaignId', args.campaignId))
			.collect();
	}
});

/**
 * How many records already carry a task for each item key, campaign-wide.
 *
 * Editing a version in place cannot reach tasks that already exist — they
 * snapshot their wording — so removing an item leaves those ticks in place on
 * the records that have them. This is what lets the edit dialog say so before
 * an admin removes something twenty records are already working through.
 */
export const countTasksByKey = query({
	args: {
		campaignId: v.id('campaigns')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return {};
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return {};
		}

		const tasks = await ctx.db
			.query('tasks')
			.withIndex('by_campaignId_and_status', (q) => q.eq('campaignId', args.campaignId))
			.collect();

		const counts: Record<string, number> = {};
		for (const task of tasks) {
			counts[task.key] = (counts[task.key] ?? 0) + 1;
		}
		return counts;
	}
});

/**
 * Every impact tag this campaign's checklists use, and where each one's stat
 * currently shows. The tag IS the stat — several items can carry the same one —
 * so the surfaces are read off the campaign's matching `publicStats` row rather
 * than off any single item.
 *
 * Read across ALL versions, not just the active one: tasks created against an
 * older version keep counting, so a tag that only appears there is still a real
 * source. Both surfaces false means the tag is tracked but shown nowhere,
 * which is also what an unconfigured tag reports.
 */
export const listImpactTags = query({
	args: {
		campaignId: v.id('campaigns')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return [];
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return [];
		}

		const templates = await ctx.db
			.query('taskTemplates')
			.withIndex('by_campaignId_and_isActive', (q) => q.eq('campaignId', args.campaignId))
			.collect();

		const tags = new Set<string>();
		for (const template of templates) {
			for (const item of template.items) {
				if (item.impactTag) tags.add(item.impactTag);
			}
		}

		const bySource = new Map(
			(campaign.publicStats ?? [])
				.filter((stat) => stat.source.kind === 'task')
				.map((stat) => [
					stat.source.kind === 'task' ? stat.source.impactTag : '',
					{ showOnPublic: stat.showOnPublic, showOnDashboard: stat.showOnDashboard }
				])
		);

		return [...tags]
			.map((tag) => ({
				tag,
				showOnPublic: bySource.get(tag)?.showOnPublic ?? false,
				showOnDashboard: bySource.get(tag)?.showOnDashboard ?? false
			}))
			.sort((a, b) => a.tag.localeCompare(b.tag));
	}
});

export const getActiveTaskTemplate = query({
	args: {
		campaignId: v.id('campaigns')
	},
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) {
			return null;
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return null;
		}

		return await ctx.db
			.query('taskTemplates')
			.withIndex('by_campaignId_and_isActive', (q) =>
				q.eq('campaignId', args.campaignId).eq('isActive', true)
			)
			.unique();
	}
});
