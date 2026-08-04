import { Migrations } from '@convex-dev/migrations';
import { components, internal } from './_generated/api.js';
import type { DataModel, Doc } from './_generated/dataModel.js';
import { slugifyTitle, uniqueSlug } from '../lib/domain/update-slug';
import { takenUpdateSlugs } from './model/updates';

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

// A `contacts` row mid-rollout: `updateDetail` is declared but not written
// yet, and `transparency` has not been dropped. Doc<'contacts'> is the NARROW
// shape and admits only the new name, so the backfill reads through this.
type LegacyTransparencyContact = Doc<'contacts'> & {
	/** Renamed: a mailing preference wearing the name of a permission. */
	transparency?: 'summary' | 'full';
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

// ------------------------------------------------------------------
// contacts.transparency becomes contacts.updateDetail
// ------------------------------------------------------------------
// The field arrived with the retired `sponsors` table, carrying its name and
// none of its behaviour. In the app it came from it decided whether two
// transactional emails printed progress numbers, and nothing else; here it is
// displayed, editable, and read by no branch at all.
//
// `summary | full` on a contact reads like an access level, and the next
// person to design a portal would build the two-tier thing it implies. So the
// values stay and the name goes: `updateDetail` says it is about what we send.
//
// Same widen -> migrate -> narrow rollout as the others:
//
//   1. Widen. Deploy `contacts` with BOTH `transparency` and `updateDetail`
//      declared optional, so either shape validates.
//   2. Migrate. `npx convex run migrations:run '{"fn":
//      "migrations:renameTransparency"}'` — copies the value across, then
//      `...:dropTransparency` removes the old column.
//   3. Narrow. Deploy the final shape in schema.ts (what is committed now).
export const renameTransparency = migrations.define({
	table: 'contacts',
	migrateOne: (_ctx, contact) => {
		const row = contact as LegacyTransparencyContact;
		// A value written after the widen deploy outranks the old column, and a
		// row with neither is left entirely alone — the field is optional and
		// "unset" is a real answer.
		if (row.transparency === undefined || row.updateDetail !== undefined) return;
		return { updateDetail: row.transparency };
	}
});

export const dropTransparency = migrations.define({
	table: 'contacts',
	// Patching a field to undefined is how Convex deletes it. The cast is for
	// the same reason as the shapes above: the field is gone from the schema.
	migrateOne: () => ({ transparency: undefined }) as Partial<Doc<'contacts'>>
});

// Updates published BEFORE `slug` existed carry none, and the wall fails closed
// on that: `toPublicUpdate` returns null for a published row without a slug,
// exactly as it does for a draft. That is the right way round — a post the
// public site cannot address is better than one addressed by something that
// might later name a different post — but it means every update published
// before this feature shipped silently disappeared from the public site. Not
// broken, not erroring, just absent, which is the failure nobody notices.
//
// The slug is minted the same way `publishUpdate` mints it, including the
// collision scan, so a backfilled address is indistinguishable from one issued
// at publish time. Idempotent: a row that already has a slug keeps it, because
// a slug is frozen once issued and reissuing one would break a link somebody
// has already shared.
// DO NOT ADD `parallelize: true` TO THIS ONE. It reads the slugs its siblings
// have already COMMITTED, so uniqueness within a batch rests entirely on
// @convex-dev/migrations running `for (const doc of page) await doOne(doc)`,
// which it does only while parallelize is unset. Turning it on for speed would
// let two rows scan the same set and mint the same slug, and nothing would
// fail: `updateBySlug` in model/updates.ts resolves with `.first()`, so one
// post keeps the address and the other 404s at a permalink it believes it
// owns. Both `getCampaignUpdate` and `getProjectUpdate` go through that one
// lookup, so hardening either permalink alone would leave the other exposed.
//
// The damage concentrates exactly where the slug fallback does. A title with no
// Latin characters — Urdu, which is the first language of the families this app
// serves — slugifies to nothing and becomes `update`, so a parallel batch would
// collapse an entire campaign's Urdu-titled posts onto one address.
export const backfillUpdateSlugs = migrations.define({
	table: 'updates',
	migrateOne: async (ctx, update) => {
		if (update.slug !== undefined) return;
		// Drafts are deliberately skipped. They have no public address to keep
		// stable, and `publishUpdate` mints the slug from whatever the title says
		// at the moment of publishing — which is the title the author settled on,
		// not the one an unfinished draft happened to be carrying.
		if (update.status !== 'published') return;

		const base = slugifyTitle(update.title);
		const taken = await takenUpdateSlugs(ctx, update.campaignId, update.projectId, base);
		return { slug: uniqueSlug(base, taken) };
	}
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
	internal.migrations.dropTaskNote,
	// Reads `transparency`, so it must run before the one that drops it.
	internal.migrations.renameTransparency,
	internal.migrations.dropTransparency,
	internal.migrations.backfillUpdateSlugs,
	internal.migrations.backfillLedgerTotals,
	internal.migrations.backfillContactSearch
]);

// ------------------------------------------------------------------
// The budget page stops reading the whole ledger
// ------------------------------------------------------------------
// `getReconciliation` and `listUnallocated` used to load EVERY transaction and
// EVERY allocation in an org, on every subscription tick, to produce five
// numbers and an inbox. That is a scan whose cost grows with everything the
// organization has ever done, and Convex caps documents read per query — so it
// does not degrade gracefully, it eventually fails outright. Online giving is
// about to make donations the highest-volume row type in the system.
//
// Both now read denormalized state instead: `transactions.allocatedCents` and
// `isFullyAllocated` per row, and one `orgMoneyTotals` row per org. Going
// forward those are maintained by the triggers in `functions.ts`, so no write
// site has to remember anything. This backfills what already exists.
//
// DO NOT ADD `parallelize: true` TO THIS ONE, for a different reason than
// `backfillUpdateSlugs` above but with the same shape of consequence. Every
// transaction in an org accumulates into that org's single totals row, so
// parallel rows would read-modify-write the same document concurrently and
// lose contributions. Nothing would fail — the org's Received figure would
// simply be too low, silently and permanently, which is the worst way for a
// money number to be wrong.
//
// Idempotent by the per-row guard: a transaction that already carries
// `isFullyAllocated` is skipped entirely, contribution included, so a re-run
// costs no writes and cannot double-count. To rebuild from scratch, run
// `migrations:resetLedgerTotals` first.
export const backfillLedgerTotals = migrations.define({
	table: 'transactions',
	migrateOne: async (ctx, transaction) => {
		// Already migrated. Skipping BEFORE touching the totals is what makes a
		// second pass safe.
		if (transaction.isFullyAllocated !== undefined) return;

		const allocations = await ctx.db
			.query('allocations')
			.withIndex('by_transactionId', (q) => q.eq('transactionId', transaction._id))
			.take(200);

		const allocatedCents = allocations.reduce((sum, row) => sum + row.amountCents, 0);
		// Clamped for the same reason the trigger clamps: the invariant says
		// sum(allocations) <= amount, but a total that can go negative from one
		// bad legacy row is not a total worth trusting.
		const unallocated = Math.max(0, transaction.amountCents - allocatedCents);

		const totals = await ctx.db
			.query('orgMoneyTotals')
			.withIndex('by_orgId', (q) => q.eq('orgId', transaction.orgId))
			.unique();

		const base = totals ?? {
			receivedCents: 0,
			sentCents: 0,
			spentCents: 0,
			unallocatedDonationCents: 0,
			unallocatedTransferCents: 0,
			unallocatedExpenditureCents: 0
		};

		const next = {
			receivedCents:
				base.receivedCents + (transaction.type === 'donation' ? transaction.amountCents : 0),
			sentCents: base.sentCents + (transaction.type === 'transfer' ? transaction.amountCents : 0),
			spentCents:
				base.spentCents + (transaction.type === 'expenditure' ? transaction.amountCents : 0),
			unallocatedDonationCents:
				base.unallocatedDonationCents + (transaction.type === 'donation' ? unallocated : 0),
			unallocatedTransferCents:
				base.unallocatedTransferCents + (transaction.type === 'transfer' ? unallocated : 0),
			unallocatedExpenditureCents:
				base.unallocatedExpenditureCents + (transaction.type === 'expenditure' ? unallocated : 0)
		};

		if (totals) {
			await ctx.db.patch('orgMoneyTotals', totals._id, next);
		} else {
			await ctx.db.insert('orgMoneyTotals', { orgId: transaction.orgId, ...next });
		}

		// `isFullyAllocated` is written explicitly rather than left to a default,
		// including for rows that ARE fully allocated. `listUnallocated` ranges on
		// `isFullyAllocated: false`, and a row whose attribution we never
		// established belongs in that inbox rather than silently outside it.
		return { allocatedCents, isFullyAllocated: allocatedCents >= transaction.amountCents };
	}
});

/**
 * Clears the denormalized ledger state so `backfillLedgerTotals` can rebuild it.
 *
 * The repair path. These numbers are derived, so the source rows are always
 * recoverable — but a total that has drifted has no way to notice on its own,
 * and "delete it and recompute" is a far better answer than trying to work out
 * by how much it is wrong.
 *
 * Run this, then `backfillLedgerTotals`, then check the result against
 * `transactions:auditLedgerTotals`.
 */
export const resetLedgerTotals = migrations.define({
	table: 'transactions',
	migrateOne: async (ctx, transaction) => {
		const totals = await ctx.db
			.query('orgMoneyTotals')
			.withIndex('by_orgId', (q) => q.eq('orgId', transaction.orgId))
			.unique();
		if (totals) await ctx.db.delete('orgMoneyTotals', totals._id);
		return { allocatedCents: undefined, isFullyAllocated: undefined } as Partial<
			Doc<'transactions'>
		>;
	}
});

// ------------------------------------------------------------------
// Contacts stop being loaded in full to be searched or counted
// ------------------------------------------------------------------
// `listContacts` had two unbounded paths. Without a `limit` it collected the
// org; WITH a search it collected the org regardless, then filtered in
// JavaScript and sliced — so the limit never bounded the read at all, and the
// admin directory ran that on every keystroke.
//
// Search now goes through a full-text index over `contacts.searchText`, and
// the dashboard's People tile reads a maintained count instead of taking
// `.length` of every person in the organization. Both are derived and both are
// maintained by the trigger in `functions.ts`; this backfills what exists.
//
// DO NOT ADD `parallelize: true`, for the same reason as
// `backfillLedgerTotals`: every contact in an org increments that org's single
// count row, so parallel rows would read-modify-write the same document and
// lose increments. A headcount that is quietly low is worse than a slow
// migration.
//
// Idempotent by the per-row guard. A contact that already has `searchText` is
// skipped entirely, count included, so a re-run costs nothing and cannot
// double-count. `resetContactSearch` rebuilds from scratch.
export const backfillContactSearch = migrations.define({
	table: 'contacts',
	migrateOne: async (ctx, contact) => {
		if (contact.searchText !== undefined) return;

		const totals = await ctx.db
			.query('orgContactTotals')
			.withIndex('by_orgId', (q) => q.eq('orgId', contact.orgId))
			.unique();

		if (totals) {
			await ctx.db.patch('orgContactTotals', totals._id, {
				contactCount: totals.contactCount + 1
			});
		} else {
			await ctx.db.insert('orgContactTotals', { orgId: contact.orgId, contactCount: 1 });
		}

		// Duplicated from `buildSearchText` in `functions.ts` rather than
		// imported, deliberately: a migration is a snapshot of what the schema
		// meant WHEN IT RAN. Importing the live helper would silently change what
		// an already-executed backfill did the next time someone edits the
		// haystack, and the trigger will recompute every row it touches anyway.
		const searchText = [
			contact.firstName,
			contact.lastName,
			contact.givenName,
			contact.middleName,
			contact.nickname,
			contact.emailLower,
			contact.organization
		]
			.filter(Boolean)
			.join(' ')
			.toLowerCase();

		return { searchText };
	}
});

/** The repair path for the above. Run this, then `backfillContactSearch`. */
export const resetContactSearch = migrations.define({
	table: 'contacts',
	migrateOne: async (ctx, contact) => {
		const totals = await ctx.db
			.query('orgContactTotals')
			.withIndex('by_orgId', (q) => q.eq('orgId', contact.orgId))
			.unique();
		if (totals) await ctx.db.delete('orgContactTotals', totals._id);
		return { searchText: undefined } as Partial<Doc<'contacts'>>;
	}
});
