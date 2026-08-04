import { v } from 'convex/values';
import { query } from '../_generated/server';
import { readableOrgId } from '../model/access';
import { taskTemplateScopeKey } from '../model/tasks';

// A campaign keeps two independent checklists — its records' and its trips' —
// so every read here names which one it wants. Absent is the record checklist,
// which is what every caller written before trips existed meant and still
// means, and which is stored as an ABSENT `scope`: see taskTemplateScopeKey for
// why the range says `undefined` rather than filtering after the fact.
const scopeValidator = v.union(v.literal('project'), v.literal('trip'));

export const listTaskTemplates = query({
	args: {
		campaignId: v.id('campaigns'),
		scope: v.optional(scopeValidator)
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'projects:read', args.campaignId);
		if (!orgId) {
			return [];
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return [];
		}

		// Every version of ONE scope, active or not — the editor lists the history.
		// Scope-blind, this would put trip checklists in the record-checklist editor
		// and the other way round.
		return await ctx.db
			.query('taskTemplates')
			.withIndex('by_campaignId_and_scope_and_isActive', (q) =>
				q
					.eq('campaignId', args.campaignId)
					.eq('scope', taskTemplateScopeKey(args.scope ?? 'project'))
			)
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
		campaignId: v.id('campaigns'),
		scope: v.optional(scopeValidator)
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'projects:read', args.campaignId);
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

		const wantsTrip = (args.scope ?? 'project') === 'trip';
		const counts: Record<string, number> = {};
		for (const task of tasks) {
			// Manual tasks carry no template key, so they count toward no item.
			if (!task.key) continue;
			// Both checklists' tasks share the campaign index, and both are free to
			// use the key "passport". Counted blind, removing an item from the record
			// checklist would report the trip's rows as records affected.
			if (wantsTrip ? !task.tripId : !task.projectId) continue;
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
		const orgId = await readableOrgId(ctx, 'projects:read', args.campaignId);
		if (!orgId) {
			return [];
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return [];
		}

		// Record checklists only, and no scope argument: a trip item is REFUSED an
		// impact tag at the write path (see assertScopeRules), because a trip task
		// has no projectId and impact stats count distinct projects. There is
		// nothing in the other scope to read.
		const templates = await ctx.db
			.query('taskTemplates')
			.withIndex('by_campaignId_and_scope_and_isActive', (q) =>
				q.eq('campaignId', args.campaignId).eq('scope', taskTemplateScopeKey('project'))
			)
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
		campaignId: v.id('campaigns'),
		scope: v.optional(scopeValidator)
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'projects:read', args.campaignId);
		if (!orgId) {
			return null;
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return null;
		}

		// `.unique()` is the invariant showing its teeth: one active version per
		// campaign AND SCOPE, held by deactivateOthers. Ranging over the campaign
		// alone would now find two — the record checklist and the trip one — and
		// throw on a page that is only trying to render a list.
		return await ctx.db
			.query('taskTemplates')
			.withIndex('by_campaignId_and_scope_and_isActive', (q) =>
				q
					.eq('campaignId', args.campaignId)
					.eq('scope', taskTemplateScopeKey(args.scope ?? 'project'))
					.eq('isActive', true)
			)
			.unique();
	}
});
