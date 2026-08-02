import { Migrations } from '@convex-dev/migrations';
import { components, internal } from './_generated/api.js';
import type { DataModel, Doc } from './_generated/dataModel.js';

export const migrations = new Migrations<DataModel>(components.migrations);
export const run = migrations.runner();

// These migrations read and clear fields the schema no longer declares, which
// is the whole point of them — but it means TypeScript, which only knows the
// CURRENT schema, cannot see those fields. The two shapes below name the
// legacy form so the casts below are narrow and explained rather than `any`
// scattered through the file. Delete a migration and its shape once every
// deployment has run it.
type LegacyChecklistItem = {
	key: string;
	label: string;
	order: number;
	impactTag?: string | null;
	/** Removed: collapsed into the stat's showOnPublic. */
	isPublic?: boolean;
};

// ------------------------------------------------------------------
// taskTemplates.items — widen the tag, add the public flag
// ------------------------------------------------------------------
// `impactTag` went from `v.union(v.literal('business'), v.literal('school'),
// v.null())` to `v.optional(v.string())`, and `isPublic` is new and required.
// Both stored strings are already valid under the new validator; a stored
// `null` is not, and no row has `isPublic` at all.
//
// Rolled out widen -> migrate -> narrow:
//
//   1. Widen. Deploy `items` with
//        impactTag: v.optional(v.union(v.string(), v.null())),
//        isPublic: v.optional(v.boolean())
//      so both the old and the new shape validate.
//   2. Migrate. `npx convex run migrations:run '{"fn":
//      "migrations:normaliseTaskTemplateItems"}'` — drops the nulls and
//      backfills `isPublic: false`, matching customFieldDefinitions' rule that
//      a thing is private until someone deliberately publishes it.
//   3. Narrow. Deploy the final shape in schema.ts (what is committed now).
//
// The migration is idempotent and left in place: a row already carrying the
// new shape is returned unchanged, so re-running it is a no-op.
export const normaliseTaskTemplateItems = migrations.define({
	table: 'taskTemplates',
	migrateOne: (_ctx, template) => {
		const items = (template.items as LegacyChecklistItem[]).map((item) => ({
			key: item.key,
			label: item.label,
			order: item.order,
			// `?? undefined` rather than a null check alone: the widened
			// validator admits null, the narrow one does not, and Convex has no
			// `undefined` — an absent key is how "no tag" is stored.
			...(item.impactTag ? { impactTag: item.impactTag } : {}),
			isPublic: item.isPublic ?? false
		}));
		return { items };
	}
});

// ------------------------------------------------------------------
// Collapsing `isPublic` into the stat's own showOnPublic
// ------------------------------------------------------------------
// A checklist item used to carry `isPublic` alongside `impactTag`, and each
// task snapshotted it. Two switches that read almost the same, and the
// snapshot meant flipping a stat public did not move the number — ticks
// recorded while it was private stayed private forever, which reads as a bug.
//
// Publishing is now one decision, made on the campaign's `publicStats` row for
// that tag: the stat is the tag, not the item. So the flag comes off both
// tables. Same widen -> migrate -> narrow rollout as above; the widened step
// makes `isPublic` optional on `taskTemplates.items[]` and on `tasks`, and
// these two migrations unset it.
//
// Anything already marked public is NOT silently lost: seedPublicTaskStats
// below turns it into the corresponding stat config before the flag is
// dropped, so a checklist item that was publishing a count keeps publishing it.
export const dropChecklistIsPublic = migrations.define({
	table: 'taskTemplates',
	migrateOne: (_ctx, template) => ({
		items: template.items.map((item) => ({
			key: item.key,
			label: item.label,
			order: item.order,
			...(item.impactTag ? { impactTag: item.impactTag } : {})
		}))
	})
});

export const dropTaskIsPublic = migrations.define({
	table: 'tasks',
	// Patching a field to undefined is how Convex deletes it. The cast is for
	// the same reason as LegacyChecklistItem: the field is gone from the schema.
	migrateOne: () => ({ isPublic: undefined }) as Partial<Doc<'tasks'>>
});

/**
 * Carry the old item-level `isPublic` forward into the campaign's stat config,
 * so a tag that was publishing a count still is. Runs BEFORE the two above,
 * while the flag is still readable.
 *
 * Only adds; never turns a stat off, and never touches a row the admin has
 * already configured. A tag that was private simply gets no row, which is the
 * same "shown nowhere" it had before.
 */
export const seedPublicTaskStats = migrations.define({
	table: 'campaigns',
	migrateOne: async (ctx, campaign) => {
		const templates = await ctx.db
			.query('taskTemplates')
			.withIndex('by_campaignId_and_isActive', (q) => q.eq('campaignId', campaign._id))
			.collect();

		const publicTags = new Set<string>();
		for (const template of templates) {
			for (const item of template.items as LegacyChecklistItem[]) {
				if (item.impactTag && item.isPublic) publicTags.add(item.impactTag);
			}
		}
		if (publicTags.size === 0) return;

		const stats = [...(campaign.publicStats ?? [])];
		const have = new Set(stats.map((stat) => stat.id));
		let order = stats.length;
		for (const tag of publicTags) {
			const id = `task:${tag}`;
			if (have.has(id)) continue;
			stats.push({
				id,
				order: order++,
				showOnPublic: true,
				showOnDashboard: false,
				source: { kind: 'task' as const, impactTag: tag }
			});
		}
		return { publicStats: stats };
	}
});

/** Runs every migration this app has, in order. Safe to re-run. */
export const runAll = migrations.runner([
	internal.migrations.normaliseTaskTemplateItems,
	// Reads isPublic, so it must run before the two that drop it.
	internal.migrations.seedPublicTaskStats,
	internal.migrations.dropChecklistIsPublic,
	internal.migrations.dropTaskIsPublic
]);
