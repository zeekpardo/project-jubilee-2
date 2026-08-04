import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireCapability } from '../model/access';
import { taskTemplateScopeKey, type TaskTemplateScope } from '../model/tasks';
import { statConfigId, type StatConfig, type StatSource } from '../../lib/domain/campaign-stats';

// Which checklist a version is. Absent means 'project' on the way IN as well as
// in storage — see the `scope` line in createTaskTemplateVersion below.
const scopeValidator = v.union(v.literal('project'), v.literal('trip'));

// At most one active version per campaign AND SCOPE, so activating one clears
// the rest of its own kind.
//
// Scope is not a refinement here, it is the whole point. Left scope-blind this
// ranged over the campaign alone, and activating a trip checklist would
// deactivate the campaign's record checklist — whose first symptom is a project
// created next week arriving with no tasks on it, a week after the change that
// caused it. The two lists are different work and deactivate independently.
async function deactivateOthers(
	ctx: MutationCtx,
	campaignId: Id<'campaigns'>,
	scope: TaskTemplateScope,
	keepId: Id<'taskTemplates'> | null
): Promise<void> {
	const active = await ctx.db
		.query('taskTemplates')
		.withIndex('by_campaignId_and_scope_and_isActive', (q) =>
			q.eq('campaignId', campaignId).eq('scope', taskTemplateScopeKey(scope)).eq('isActive', true)
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
		impactTag: v.optional(v.string()),
		// Trip scope only, and refused elsewhere: an item answered once PER PERSON
		// rather than once per trip. See assertScopeRules.
		perAttendee: v.optional(v.boolean())
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

/**
 * The two item flags that only make sense in one scope, refused rather than
 * ignored — a stored field nothing reads is a field someone will one day
 * believe.
 *
 * `impactTag` on a TRIP item is the guard rail §6 asks for, moved to the
 * earliest place that can hold it. A trip task has no projectId, impact stats
 * count DISTINCT projectId, so the tag would count zero forever; catching it
 * when the checklist is saved names the mistake to the person who made it,
 * where catching it at instantiation would fail a trip create instead. The task
 * write path enforces the same pair (see IMPACT_TAG_NEEDS_PROJECT in
 * tasks/mutations.ts) — this is the template-shaped statement of one rule, not
 * a second rule.
 *
 * `perAttendee` on a PROJECT item has nothing to fan out over: a record has no
 * roster.
 */
function assertScopeRules(
	scope: TaskTemplateScope,
	items: { key: string; impactTag?: string; perAttendee?: boolean }[]
): void {
	for (const item of items) {
		if (scope === 'trip' && item.impactTag?.trim()) {
			throw new ConvexError(
				`"${item.key}" cannot carry an impact tag. Impact stats count distinct records, and a trip checklist item is not about a record — tag the record checklist item instead.`
			);
		}
		if (scope !== 'trip' && item.perAttendee) {
			throw new ConvexError(`"${item.key}" can only be per-person on a trip checklist.`);
		}
	}
}

/** The stored shape: a blank tag is no tag, and a false flag is no flag. */
function normaliseItems(
	items: { key: string; label: string; order: number; impactTag?: string; perAttendee?: boolean }[]
) {
	return items.map((item) => ({
		key: item.key,
		label: item.label,
		order: item.order,
		// An empty string would land in the by_campaignId_and_impactTag index
		// under a tag nothing looks for.
		...(item.impactTag?.trim() ? { impactTag: item.impactTag.trim() } : {}),
		// Absent and false mean the same thing, so only one of them is ever
		// stored — the same choice `impactTag` makes just above.
		...(item.perAttendee ? { perAttendee: true } : {})
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
		// Absent is the record checklist, which is what every caller written
		// before trips existed meant and still means.
		scope: v.optional(scopeValidator),
		items: itemsValidator,
		statSurfaces: v.optional(statSurfacesValidator),
		effectiveFrom: v.optional(v.string()),
		activate: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'campaign:edit', args.campaignId);

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			throw new ConvexError('Campaign not found');
		}

		const scope: TaskTemplateScope = args.scope ?? 'project';

		// Version numbers are unique per CAMPAIGN, not per campaign and scope: the
		// index says so, and widening it would be a schema change for the sake of
		// letting two different lists both be called "v1" — which is a thing to be
		// glad they cannot be, since a task records only the version it agreed to.
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
		assertScopeRules(scope, args.items);

		const activate = args.activate ?? false;
		if (activate) {
			await deactivateOthers(ctx, args.campaignId, scope, null);
		}

		const templateId = await ctx.db.insert('taskTemplates', {
			orgId,
			campaignId: args.campaignId,
			version: args.version,
			// STORED THROUGH THE SAME FUNCTION THE READS RANGE OVER, so project
			// scope is written ABSENT and never as the literal 'project'. A row
			// spelling it out would sit outside the `scope: undefined` range every
			// project-scope read uses: invisible to the editor, and untouchable by
			// deactivateOthers — which is a campaign with two active record
			// checklists, and `.unique()` throwing on a page trying to render one.
			scope: taskTemplateScopeKey(scope),
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
		const { orgId } = await requireCapability(ctx, 'campaign:edit');

		const template = await ctx.db.get('taskTemplates', args.taskTemplateId);
		if (!template || template.orgId !== orgId) {
			throw new ConvexError('Task template not found');
		}
		await requireCapability(ctx, 'campaign:edit', template.campaignId);

		assertUniqueKeys(args.items);
		// The scope is the version's, not the caller's: which list this is was
		// decided when it was created and is not a thing an edit may change. Every
		// task already created against it is keyed to a trip or to a record.
		assertScopeRules(template.scope ?? 'project', args.items);

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
		const { orgId } = await requireCapability(ctx, 'campaign:edit');

		const template = await ctx.db.get('taskTemplates', args.taskTemplateId);
		if (!template || template.orgId !== orgId) {
			throw new ConvexError('Task template not found');
		}
		await requireCapability(ctx, 'campaign:edit', template.campaignId);

		// Only versions of its own scope are cleared: a campaign's record checklist
		// and its trip checklist are both active at once, on purpose.
		await deactivateOthers(ctx, template.campaignId, template.scope ?? 'project', template._id);

		if (!template.isActive) {
			await ctx.db.patch('taskTemplates', template._id, { isActive: true });
		}

		return template._id;
	}
});
