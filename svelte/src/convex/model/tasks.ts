// Instantiating a checklist from its campaign's active task template, and
// keeping it in step as the template moves on. Two checklists live here and
// share every mechanism: a PROJECT's record checklist, and a TRIP's travel
// readiness list. They differ only in what a template item is keyed to and in
// the one item flag that fans an item out per traveller.
//
// A task is a SNAPSHOT of the template item it came from: label and impactTag
// are copied onto the row, and the version it was created against is recorded.
// Same contract as `budgets` snapshotting a costTemplates version — rewording a
// checklist item must not rewrite what a completed task meant when it was
// ticked.
//
// Whether the tag's count is PUBLISHED is not snapshotted: that lives on the
// campaign's publicStats row and is read live, so flipping a stat public
// includes ticks recorded before the switch was flipped.

import { ConvexError } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';

export type TaskTemplateItem = Doc<'taskTemplates'>['items'][number];

/**
 * Which checklist a template version is: the campaign's RECORD checklist or its
 * TRIP checklist. A campaign has one active version of each, and they are
 * different lists of different work.
 */
export type TaskTemplateScope = 'project' | 'trip';

/**
 * How a scope is spelled inside an index range.
 *
 * Project scope is stored ABSENT, never as the literal `'project'` — that is
 * what let `scope` ship without a backfill, since every row written before it
 * existed already means "project". The write path keeps the same rule (see
 * normaliseTaskTemplateScope in taskTemplates/mutations.ts), so a single
 * spelling is the only one that ever reaches the index.
 *
 * An index carrying an optional field matches a missing field against
 * `undefined`, so `.eq('scope', undefined)` is an exact range and not a scan —
 * the same explicit-undefined-in-an-index pattern `updates` uses to read a
 * campaign-level feed. It matters for the same reason: a post-index `.filter`
 * can return a short page while rows remain, which reads as "there are none".
 */
export function taskTemplateScopeKey(scope: TaskTemplateScope): 'trip' | undefined {
	return scope === 'trip' ? 'trip' : undefined;
}

/**
 * The campaign's active checklist version for one scope, or null when it has
 * none.
 *
 * The scope argument defaults to `'project'` so every caller that predates
 * trips — and every future one that only cares about records — keeps asking the
 * question it was already asking.
 */
export async function activeTaskTemplate(
	ctx: QueryCtx,
	campaignId: Id<'campaigns'>,
	scope: TaskTemplateScope = 'project'
): Promise<Doc<'taskTemplates'> | null> {
	return await ctx.db
		.query('taskTemplates')
		.withIndex('by_campaignId_and_scope_and_isActive', (q) =>
			q.eq('campaignId', campaignId).eq('scope', taskTemplateScopeKey(scope)).eq('isActive', true)
		)
		.unique();
}

/** A project in the caller's org, or a hard failure. */
export async function requireTaskProject(
	ctx: MutationCtx,
	orgId: string,
	projectId: Id<'projects'>
): Promise<Doc<'projects'>> {
	const project = await ctx.db.get('projects', projectId);
	if (!project || project.orgId !== orgId) {
		throw new ConvexError('Project not found');
	}
	return project;
}

/** A trip in the caller's org, or a hard failure. Twin of the above. */
export async function requireTaskTrip(
	ctx: MutationCtx,
	orgId: string,
	tripId: Id<'trips'>
): Promise<Doc<'trips'>> {
	const trip = await ctx.db.get('trips', tripId);
	if (!trip || trip.orgId !== orgId) {
		throw new ConvexError('Trip not found');
	}
	return trip;
}

/**
 * Create any of the active template's items this project does not have yet,
 * and return how many were added.
 *
 * ADDITIVE ONLY. An item dropped from a newer template version leaves the
 * already-created task alone: it may be ticked, and deleting it would erase
 * work that actually happened. Nor is an existing task re-snapshotted from the
 * newer wording — that is the whole point of snapshotting. So syncing twice, or
 * after a new version is activated, only ever fills in what is missing.
 */
export async function instantiateTasks(
	ctx: MutationCtx,
	project: Doc<'projects'>
): Promise<number> {
	const template = await activeTaskTemplate(ctx, project.campaignId);
	if (!template) {
		throw new ConvexError('This campaign has no active task template');
	}

	const existing = await ctx.db
		.query('tasks')
		.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
		.collect();
	// Manual tasks on the same project carry no key, so they contribute
	// `undefined` here and can never collide with a template item.
	const have = new Set(existing.map((task) => task.key));

	let created = 0;
	for (const item of template.items) {
		if (have.has(item.key)) continue;
		await ctx.db.insert('tasks', {
			orgId: project.orgId,
			projectId: project._id,
			campaignId: project.campaignId,
			// The discriminator, and what makes templateVersion/key/label
			// read-only downstream: these came from the checklist, so editing them
			// per-record would make records disagree about the same step.
			source: 'template' as const,
			templateVersion: template.version,
			key: item.key,
			label: item.label,
			order: item.order,
			// A checklist item is ordinary work until someone says otherwise.
			// Urgency belongs to the situation, not to the template.
			priority: 'normal' as const,
			// Absent stays absent: an untagged item feeds no stat, and writing an
			// empty string would put it in the by_campaignId_and_impactTag index
			// under a tag nothing looks for.
			...(item.impactTag ? { impactTag: item.impactTag } : {}),
			status: 'todo' as const
		});
		created++;
	}

	return created;
}

// ------------------------------------------------------------------
// Trips
// ------------------------------------------------------------------

/**
 * One task the trip's checklist is missing. `contactId` is set only for a
 * `perAttendee` item, and names the traveller the task is for.
 */
export type PendingTripTask = { item: TaskTemplateItem; contactId?: Id<'contacts'> };

/**
 * The dedupe key for a per-attendee task. A NUL joins the two halves because it
 * is the one byte a template key cannot contain: any printable separator could
 * appear inside a key, and then two different (key, person) pairs would fold
 * into one string and one of the two people would silently never get the task.
 */
function perAttendeeKey(key: string, contactId: Id<'contacts'>): string {
	return `${key}\u0000${contactId}`;
}

/**
 * What the trip's active checklist defines that the trip does not have yet.
 *
 * Shared by instantiation and by the read that offers to run it, so the count
 * the UI shows and the rows the mutation writes can never disagree — the same
 * relationship `listProjectChecklist` has with `instantiateTasks`, expressed as
 * one function instead of two implementations of the same set difference.
 *
 * Existing tasks are read off `by_tripId` and matched in memory rather than
 * probed one key at a time. That is bounded on purpose: tens of items × tens of
 * travellers is the whole population of a trip's checklist, and one index read
 * beats one round trip per (item, person) pair.
 */
export async function pendingTripTasks(
	ctx: QueryCtx,
	trip: Doc<'trips'>
): Promise<{ template: Doc<'taskTemplates'> | null; missing: PendingTripTask[] }> {
	const template = await activeTaskTemplate(ctx, trip.campaignId, 'trip');
	if (!template) return { template: null, missing: [] };

	const existing = await ctx.db
		.query('tasks')
		.withIndex('by_tripId', (q) => q.eq('tripId', trip._id))
		.collect();
	// Manual trip tasks carry no key, so they contribute `undefined` here and can
	// never collide with a template item.
	const haveKeys = new Set(existing.map((task) => task.key));
	const havePerAttendee = new Set(
		existing.flatMap((task) =>
			task.key && task.assignee?.kind === 'contact'
				? [perAttendeeKey(task.key, task.assignee.contactId)]
				: []
		)
	);

	// Only read the roster if something actually fans out over it. A trip
	// checklist of "book lodging, hire a van" should not pay for the roster.
	const wantsAttendees = template.items.some((item) => item.perAttendee);
	const attendees = wantsAttendees
		? await ctx.db
				.query('tripAttendees')
				.withIndex('by_tripId', (q) => q.eq('tripId', trip._id))
				.collect()
		: [];
	// Non-declined, per the spec: `declined` is the person having said no, and a
	// passport row for someone who is not going is noise on the one screen whose
	// job is to be scannable. Every other status is someone the coordinator still
	// has to clear, `cancelled` included — their tasks exist already anyway, since
	// instantiation is additive-only and cannot take back what it made while they
	// were confirmed.
	const travelling = attendees.filter((attendee) => attendee.status !== 'declined');

	const missing: PendingTripTask[] = [];
	for (const item of template.items) {
		if (!item.perAttendee) {
			if (haveKeys.has(item.key)) continue;
			missing.push({ item });
			continue;
		}
		for (const attendee of travelling) {
			if (havePerAttendee.has(perAttendeeKey(item.key, attendee.contactId))) continue;
			missing.push({ item, contactId: attendee.contactId });
		}
	}
	return { template, missing };
}

/**
 * Create any of the active TRIP checklist's items this trip does not have yet,
 * and return how many were added.
 *
 * ADDITIVE ONLY, for exactly the reasons `instantiateTasks` is, and that is
 * what makes it the single call behind all three of its callers: trip create,
 * adding an attendee, and the "sync checklist" button. Adding a twelfth
 * traveller in November and running it again fills in that person's rows and
 * touches nobody else's.
 *
 * Two ways it differs from its project twin, both deliberate:
 *
 *   - A `perAttendee` item becomes one task per non-declined traveller, each
 *     assigned `{ kind: 'contact', contactId }`. "Passport valid six months past
 *     return" is twelve answers, not one, and a single shared tick would hide
 *     the one person who cannot board. The dedupe key widens to match:
 *     (tripId, key) for a trip-wide item, (tripId, key, contactId) for this one.
 *   - A campaign with NO active trip checklist is not an error. The project twin
 *     throws because its only caller is someone asking for a checklist, where
 *     two of these three callers are just creating a trip or adding a person —
 *     and refusing to create a trip because a campaign never wrote a travel
 *     checklist would be a rule nobody asked for. Nothing to add is 0 added.
 *
 * `impactTag` is deliberately NOT copied off the item. A trip task has no
 * projectId, impact stats count DISTINCT projectId, so a tagged one would count
 * zero forever — the same rule `createTask` enforces. Trip-scope items are
 * refused a tag at the template write path, so this only ever drops one that
 * predates that check.
 */
export async function instantiateTripTasks(ctx: MutationCtx, trip: Doc<'trips'>): Promise<number> {
	const { template, missing } = await pendingTripTasks(ctx, trip);
	if (!template) return 0;

	for (const pending of missing) {
		await ctx.db.insert('tasks', {
			orgId: trip.orgId,
			// Carried directly, never traversed, exactly as the project path does —
			// and it is what puts a trip task on the campaign's task list without a
			// join. No projectId: this is travel readiness, not work on a record.
			campaignId: trip.campaignId,
			tripId: trip._id,
			source: 'template' as const,
			templateVersion: template.version,
			key: pending.item.key,
			label: pending.item.label,
			order: pending.item.order,
			priority: 'normal' as const,
			// Absent for a trip-wide item, and the traveller for a per-attendee one.
			// The assignee IS the fan-out: it says whose passport this row is about,
			// and it is what the dedupe above matches on.
			...(pending.contactId
				? { assignee: { kind: 'contact' as const, contactId: pending.contactId } }
				: {}),
			status: 'todo' as const
		});
	}

	return missing.length;
}

/** Every task row for a trip, in checklist order. */
export async function listTripTasks(ctx: QueryCtx, tripId: Id<'trips'>): Promise<Doc<'tasks'>[]> {
	const tasks = await ctx.db
		.query('tasks')
		.withIndex('by_tripId', (q) => q.eq('tripId', tripId))
		.collect();
	// Same stable order as a project's checklist, with one more tie-break: the
	// rows of one per-attendee item share an order AND a key, so without the
	// assignee they would come back in whatever order the index handed over.
	return tasks.sort(
		(a, b) =>
			a.order - b.order ||
			(a.key ?? '').localeCompare(b.key ?? '') ||
			assigneeSortKey(a).localeCompare(assigneeSortKey(b))
	);
}

/** Stable, meaningless, and only ever used to break a tie. */
function assigneeSortKey(task: Doc<'tasks'>): string {
	if (!task.assignee) return '';
	return task.assignee.kind === 'contact' ? task.assignee.contactId : task.assignee.userId;
}

/** Every task row for a project, in checklist order. */
export async function listProjectTasks(
	ctx: QueryCtx,
	projectId: Id<'projects'>
): Promise<Doc<'tasks'>[]> {
	const tasks = await ctx.db
		.query('tasks')
		.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
		.collect();
	// Tie-break on key so a project's checklist has one stable order. Manual
	// tasks have none, and sort ahead of template items sharing their `order`.
	return tasks.sort((a, b) => a.order - b.order || (a.key ?? '').localeCompare(b.key ?? ''));
}
