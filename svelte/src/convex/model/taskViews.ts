// ============================================================
// The task list, server side — one person, one rule, and the saved views
// ============================================================
// `lib/features/tasks/filters.ts` owns the RULE for whether a task belongs to a
// person. What it cannot own is the LINK between an org member and a contact
// record: `contacts.authUserId` is a database row, and that module is pure by
// design so both pages and their tests can run it.
//
// That lookup is `resolvePersonIdentity`, and it now lives in `model/identity.ts`
// because the portal needs the same link for a different reason. Every assignee
// question the server answers — "assigned to me", `assignee=user:<id>`,
// `assignee=contact:<id>` — goes through `resolveAssigneeFilter` below and comes
// out as a `TaskViewer`, which `isAssignedToViewer` then judges. Nothing else in
// this codebase may compare an assignee to a person; that comparison drifting
// per call site is the spec's second risk, and there is one place it is written
// down.
//
// The saved views share this file because the only server-side judgement a view
// needs is who may write one. Its `query` is stored verbatim, so there is no
// filter shape here to keep in step with the pure module.
// ============================================================

import { v } from 'convex/values';
import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { isAssignedToViewer } from '../../lib/features/tasks/filters';
import type { TaskAssignee, TaskViewer } from '../../lib/features/tasks/types';
import { resolvePersonIdentity } from './identity';
import {
	humanizeToken,
	resolveStatConfigs,
	statConfigId,
	type StatConfig
} from '../../lib/domain/campaign-stats';

/**
 * The hard ceiling on one list read. Filters and sorts combine arbitrarily and
 * cannot all be indexed, so the handler reads a bounded page off the most
 * selective index and finishes the job in memory. Right at hundreds of tasks,
 * wrong at tens of thousands — the fix then is cursor pagination over the
 * sorted index, not a bigger number. `listTasks` reports `truncated` so a cut
 * page never reads as missing data.
 */
export const TASK_PAGE_MAX = 500;

/**
 * The ceiling on the FACET read — the scan behind "which values do the filter
 * dropdowns actually offer".
 *
 * Deliberately larger than `TASK_PAGE_MAX` and deliberately its own number.
 * Deriving the dropdowns from the returned page would hide every value that
 * only exists past the page cap, so this is a separate read; it can afford a
 * bigger slice because it never hydrates a row — it collects ids and throws the
 * documents away. It can still be hit, and `listTaskFacets` reports `truncated`
 * for the same reason the list does: a short list of options that looks
 * complete is worse than one that says it is not.
 */
export const TASK_FACET_MAX = 2000;

/**
 * How many DISTINCT values one dropdown may offer. The scan is cheap, but every
 * distinct contact and record costs a document read to name it — and a select
 * with two hundred entries has stopped being a shortlist anyway.
 */
export const TASK_FACET_OPTION_MAX = 200;

/** How many tasks one bulk call may touch. A mutation is a transaction. */
export const BULK_TASK_MAX = 200;

/** Saved views are a sidebar, not a table. Bounded so no read here is unbounded. */
export const TASK_VIEW_MAX = 200;

// ------------------------------------------------------------------
// Shared validators
// ------------------------------------------------------------------

/** Mirrors `tasks.assignee`. Used by every WRITE — these ids come from a picker. */
export const taskAssigneeValidator = v.union(
	v.object({ kind: v.literal('user'), userId: v.string() }),
	v.object({ kind: v.literal('contact'), contactId: v.id('contacts') })
);

/**
 * The READ-side twin, and deliberately not the same: a filter arrives from a
 * hand-edited URL or a saved view written by an older build, so `contactId` is
 * a plain string. `v.id('contacts')` would reject junk with an argument
 * validation error — a stack trace where the pure parser's whole posture is
 * that a broken filter shows the default list.
 */
export const taskAssigneeFilterValidator = v.union(
	v.object({ kind: v.literal('me') }),
	v.object({ kind: v.literal('unassigned') }),
	v.object({ kind: v.literal('user'), userId: v.string() }),
	v.object({ kind: v.literal('contact'), contactId: v.string() })
);

export const taskPriorityValidator = v.union(
	v.literal('low'),
	v.literal('normal'),
	v.literal('high'),
	v.literal('urgent')
);

export const taskStatusValidator = v.union(v.literal('todo'), v.literal('done'));

/** `'all'` is a real choice, not the absence of one — the default hides done work. */
export const taskStatusFilterValidator = v.union(taskStatusValidator, v.literal('all'));

export const taskSortValidator = v.union(
	v.literal('dueOn'),
	v.literal('priority'),
	v.literal('label'),
	v.literal('assignee'),
	v.literal('status'),
	v.literal('project')
);

export const taskSortDirValidator = v.union(v.literal('asc'), v.literal('desc'));

// ------------------------------------------------------------------
// One person, two ids
// ------------------------------------------------------------------

/** An assignee filter with both halves of its person already looked up. */
export type ResolvedAssigneeFilter =
	| { kind: 'unassigned' }
	| { kind: 'person'; person: TaskViewer };

export type TaskAssigneeFilterArg =
	| { kind: 'me' }
	| { kind: 'unassigned' }
	| { kind: 'user'; userId: string }
	| { kind: 'contact'; contactId: string };

/**
 * Turn the URL's assignee filter into something `isAssignedToViewer` can judge.
 *
 * `me` is resolved from the VIEWER rather than from the filter, which is what
 * makes a shared "My tasks" view mean "whoever is looking" — the pure module
 * keeps it as an intent for exactly this reason.
 */
export async function resolveAssigneeFilter(
	ctx: QueryCtx,
	orgId: string,
	filter: TaskAssigneeFilterArg | undefined,
	viewer: TaskViewer
): Promise<ResolvedAssigneeFilter | null> {
	if (!filter) return null;
	if (filter.kind === 'unassigned') return { kind: 'unassigned' };
	if (filter.kind === 'me') return { kind: 'person', person: viewer };

	const seed: TaskViewer =
		filter.kind === 'user' ? { userId: filter.userId } : { contactId: filter.contactId };
	return { kind: 'person', person: await resolvePersonIdentity(ctx, orgId, seed) };
}

/**
 * Does this task's assignee satisfy the resolved filter? The whole point of the
 * shape above is that this function is four lines and delegates the actual
 * judgement to the one rule in the pure module.
 */
export function matchesResolvedAssignee(
	assignee: TaskAssignee | undefined,
	resolved: ResolvedAssigneeFilter | null
): boolean {
	if (!resolved) return true;
	if (resolved.kind === 'unassigned') return !assignee;
	return isAssignedToViewer(assignee, resolved.person);
}

// ------------------------------------------------------------------
// Which numbers are on the donor page
// ------------------------------------------------------------------

/**
 * The public label of the stat this tag feeds, or null when the tag feeds
 * nothing the public can see.
 *
 * Ticking or deleting a tagged task moves a count of DISTINCT projects. When
 * that count is published, the confirm has to name the consequence — the spec's
 * position is that it is the admin's call to make, not the app's to make
 * silently.
 *
 * Read live, never snapshotted: whether a number is published is a
 * present-tense decision on the campaign's `publicStats` row, which is also why
 * flipping a stat public retroactively includes ticks recorded beforehand.
 */
export function publicTaskStatLabel(
	campaign: Doc<'campaigns'>,
	impactTag: string | undefined
): string | null {
	if (!impactTag) return null;

	// An UNSET selection falls back to the registry defaults, which hold no task
	// stats at all — so a campaign nobody has configured publishes no tag.
	const configs = resolveStatConfigs(campaign.publicStats as StatConfig[] | undefined);
	const id = statConfigId({ kind: 'task', impactTag });
	const config = configs.find((candidate) => candidate.id === id);
	if (!config || !config.showOnPublic) return null;

	return config.label?.trim() || humanizeToken(impactTag);
}
