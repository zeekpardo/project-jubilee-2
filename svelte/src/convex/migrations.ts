import { Migrations } from '@convex-dev/migrations';
import { components, internal } from './_generated/api.js';
import type { DataModel, Doc } from './_generated/dataModel.js';

export const migrations = new Migrations<DataModel>(components.migrations);
export const run = migrations.runner();

// These migrations read and clear fields the schema no longer declares, which
// is the whole point of them — but it means TypeScript, which only knows the
// CURRENT schema, cannot see those fields. The shapes below name the legacy
// forms so the casts are narrow and explained rather than `any` scattered
// through the file. Delete a migration and its shape once every deployment has
// run it.
type LegacyChecklistItem = {
	key: string;
	label: string;
	order: number;
	impactTag?: string | null;
	/** Removed: collapsed into the stat's showOnPublic. */
	isPublic?: boolean;
};

// A `tasks` row mid-rollout, during the widened step: the three new fields are
// not written yet and `note` has not been dropped. Doc<'tasks'> is the NARROW
// shape and admits neither, so the backfill reads through this.
type WideningTask = Omit<Doc<'tasks'>, 'source' | 'priority' | 'description'> & {
	source?: Doc<'tasks'>['source'];
	priority?: Doc<'tasks'>['priority'];
	description?: string;
	/** Removed: its text moved to `description`. */
	note?: string;
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

// ------------------------------------------------------------------
// Moving one org's protected key off the shared denylist
// ------------------------------------------------------------------
// PROTECTED_FIELD_KEYS carried `managed_missions_link` — the name of one
// organization's integration — as a rule every tenant inherited. The shared
// list is for what endangers the PEOPLE this app serves; a tenant's own keys
// belong to that tenant. This copies it into every existing org's settings so
// nothing it was protecting becomes publishable, then the shared list drops it.
//
// Additive and idempotent: an org that already lists the key is untouched.
export const moveOrgProtectedKeys = migrations.define({
	table: 'orgSettings',
	migrateOne: (_ctx, settings) => {
		const keys = settings.protectedFieldKeys ?? [];
		if (keys.includes('managed_missions_link')) return;
		return { protectedFieldKeys: [...keys, 'managed_missions_link'] };
	}
});

// ------------------------------------------------------------------
// tasks grows past the checklist
// ------------------------------------------------------------------
// `tasks` used to be one thing — a checklist item instantiated against a
// project — so `projectId`, `templateVersion` and `key` were all required and
// the only free text was a field called `note`. It now also holds work someone
// typed in, which may name no project at all, so the discriminator `source`
// and a `priority` become required and `note` becomes `description`: the same
// text under a name that says it is the body of the task, not a remark about
// it.
//
// Same widen -> migrate -> narrow rollout as above:
//
//   1. Widen. Deploy `tasks` with `projectId`, `templateVersion` and `key`
//      optional, `source`/`priority`/`description` optional, and `note` still
//      declared, so both the old and the new shape validate.
//   2. Migrate. `npx convex run migrations:run '{"fn":
//      "migrations:backfillTaskDefaults"}'` then `...:dropTaskNote`.
//   3. Narrow. Deploy the final shape in schema.ts (what is committed now).
export const backfillTaskDefaults = migrations.define({
	table: 'tasks',
	migrateOne: (_ctx, task) => {
		const row = task as WideningTask;
		const patch: Partial<Doc<'tasks'>> = {};

		// Every row that predates this change came from a template — that was the
		// only way to create one. Guarded rather than written unconditionally
		// because this migration is left in place: a re-run after manual tasks
		// exist must not relabel them as template-derived, or reset a priority
		// someone deliberately raised.
		if (row.source === undefined) patch.source = 'template';
		if (row.priority === undefined) patch.priority = 'normal';
		// Only when there is something to carry and nothing already there: a
		// description written after the widen deploy outranks the old note.
		if (row.note && row.description === undefined) patch.description = row.note;

		// Nothing to do is returned as nothing, so an already-migrated row is not
		// rewritten and a second pass costs no writes.
		return Object.keys(patch).length > 0 ? patch : undefined;
	}
});

export const dropTaskNote = migrations.define({
	table: 'tasks',
	// Patching a field to undefined is how Convex deletes it. The cast is for
	// the same reason as WideningTask: the field is gone from the schema.
	migrateOne: () => ({ note: undefined }) as Partial<Doc<'tasks'>>
});

/** Runs every migration this app has, in order. Safe to re-run. */
export const runAll = migrations.runner([
	internal.migrations.normaliseTaskTemplateItems,
	// Reads isPublic, so it must run before the two that drop it.
	internal.migrations.seedPublicTaskStats,
	internal.migrations.dropChecklistIsPublic,
	internal.migrations.dropTaskIsPublic,
	internal.migrations.moveOrgProtectedKeys,
	// Reads `note`, so it must run before the one that drops it.
	internal.migrations.backfillTaskDefaults,
	internal.migrations.dropTaskNote
]);
