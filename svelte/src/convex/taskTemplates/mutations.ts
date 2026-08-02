import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireOrgId } from '../model/auth';
import { statConfigId, type StatConfig, type StatSource } from '../../lib/domain/campaign-stats';

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

// impactTag is free text so a campaign can tag "Well drilled" without a schema
// change. Where the resulting count APPEARS is not on the item — see
// statSurfacesValidator below.
const itemsValidator = v.array(
	v.object({
		key: v.string(),
		label: v.string(),
		order: v.number(),
		impactTag: v.optional(v.string())
	})
);

// Where each tag's stat appears. Submitted alongside the items so the checklist
// screen is one save: the tag and the surfaces it shows on are edited together,
// and a Convex mutation is a transaction, so they cannot half-apply.
const statSurfacesValidator = v.array(
	v.object({
		impactTag: v.string(),
		showOnPublic: v.boolean(),
		showOnDashboard: v.boolean()
	})
);

/** Every item key must be its own. Shared by create and update. */
function assertUniqueKeys(items: { key: string }[]): void {
	const keys = new Set<string>();
	for (const item of items) {
		if (keys.has(item.key)) {
			throw new ConvexError(`Duplicate task item key "${item.key}"`);
		}
		keys.add(item.key);
	}
}

/** The stored shape: a blank tag is no tag. */
function normaliseItems(
	items: { key: string; label: string; order: number; impactTag?: string }[]
) {
	return items.map((item) => ({
		key: item.key,
		label: item.label,
		order: item.order,
		// An empty string would land in the by_campaignId_and_impactTag index
		// under a tag nothing looks for.
		...(item.impactTag?.trim() ? { impactTag: item.impactTag.trim() } : {})
	}));
}

/**
 * Bring the campaign's stat selection into line with what the checklist screen
 * just said about each tag.
 *
 * ADDS AND UPDATES ONLY. A tag whose stat already exists has its surfaces
 * patched, keeping the order and any label override the admin set. A tag with
 * no stat yet gets one appended — but only if it is actually going somewhere,
 * so an untoggled tag does not litter the list with rows shown nowhere.
 *
 * It never DELETES a row. A tag can live in another version of the checklist
 * and on tasks already ticked, so removing the stat is a deliberate act on the
 * impact list rather than a side effect of editing an item.
 */
async function reconcileTaskStats(
	ctx: MutationCtx,
	campaign: Doc<'campaigns'>,
	surfaces: { impactTag: string; showOnPublic: boolean; showOnDashboard: boolean }[]
): Promise<void> {
	if (surfaces.length === 0) return;

	const stats = [...((campaign.publicStats ?? []) as StatConfig[])];
	let changed = false;

	for (const surface of surfaces) {
		const impactTag = surface.impactTag.trim();
		if (!impactTag) continue;

		const source: StatSource = { kind: 'task', impactTag };
		const id = statConfigId(source);
		const existing = stats.findIndex((stat) => stat.id === id);

		if (existing >= 0) {
			const row = stats[existing];
			if (
				row.showOnPublic === surface.showOnPublic &&
				row.showOnDashboard === surface.showOnDashboard
			) {
				continue;
			}
			stats[existing] = {
				...row,
				showOnPublic: surface.showOnPublic,
				showOnDashboard: surface.showOnDashboard
			};
			changed = true;
			continue;
		}

		if (!surface.showOnPublic && !surface.showOnDashboard) continue;
		stats.push({
			id,
			order: stats.length,
			showOnPublic: surface.showOnPublic,
			showOnDashboard: surface.showOnDashboard,
			source
		});
		changed = true;
	}

	if (!changed) return;
	await ctx.db.patch('campaigns', campaign._id, {
		publicStats: stats.map((stat, index) => ({ ...stat, order: index }))
	});
}

// A new version is how a checklist changes SHAPE over time; updateTaskTemplate
// below fixes a version in place. Both are safe because a task snapshots its
// item's wording when it is created — see model/tasks.ts.
export const createTaskTemplateVersion = mutation({
	args: {
		campaignId: v.id('campaigns'),
		version: v.string(),
		items: itemsValidator,
		statSurfaces: v.optional(statSurfacesValidator),
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

		assertUniqueKeys(args.items);

		const activate = args.activate ?? false;
		if (activate) {
			await deactivateOthers(ctx, args.campaignId, null);
		}

		const templateId = await ctx.db.insert('taskTemplates', {
			orgId,
			campaignId: args.campaignId,
			version: args.version,
			effectiveFrom: args.effectiveFrom,
			isActive: activate,
			items: normaliseItems(args.items)
		});

		await reconcileTaskStats(ctx, campaign, args.statSurfaces ?? []);

		return templateId;
	}
});

/**
 * Edit a version in place: add an item, drop one, reword one, retag one.
 *
 * This does NOT rewrite history, because a task snapshots its item's label and
 * tag when the task is created (see model/tasks.ts). Editing the template
 * changes what FUTURE tasks are born with; every tick already recorded keeps
 * the wording it was ticked against.
 *
 * The surface toggles are different: they belong to the TAG, not the item, and
 * apply live. Turning one public includes ticks recorded before the switch was
 * flipped, which is what an admin flipping it expects.
 *
 * Two consequences worth knowing, both surfaced in the admin UI:
 *
 *   - Removing an item does not delete tasks already created from it. Those
 *     are work that actually happened, on records that still exist; deleting
 *     them would erase it. They simply stop being offered to new records.
 *   - An existing item's `key` is immutable — same rule as pipelineStages and
 *     customFieldDefinitions. The key is how a project's tasks are matched
 *     back to the template, so renaming one would orphan every task carrying
 *     it and then re-create the item as if it were new.
 */
export const updateTaskTemplate = mutation({
	args: {
		taskTemplateId: v.id('taskTemplates'),
		items: itemsValidator,
		statSurfaces: v.optional(statSurfacesValidator),
		effectiveFrom: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);

		const template = await ctx.db.get('taskTemplates', args.taskTemplateId);
		if (!template || template.orgId !== orgId) {
			throw new ConvexError('Task template not found');
		}

		assertUniqueKeys(args.items);

		await ctx.db.patch('taskTemplates', template._id, {
			items: normaliseItems(args.items),
			effectiveFrom: args.effectiveFrom
		});

		const campaign = await ctx.db.get('campaigns', template.campaignId);
		if (campaign) {
			await reconcileTaskStats(ctx, campaign, args.statSurfaces ?? []);
		}

		return template._id;
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
