// ============================================================
// Task types — the shapes the pure filter module works against
// ============================================================
// Nothing here imports Convex. `filters.ts` is unit-tested and shared by the
// campaign page, the admin page and (eventually) the server handler that
// applies the leftover filters after the indexed read, so it must not drag a
// generated `Id<'contacts'>` or a `Doc<'tasks'>` behind it. Ids are plain
// strings; the call sites already hold the branded ones.
//
// `TaskLike` is structural for the same reason: a comparator only needs the
// five columns it sorts on, so a row assembled for a test, a row joined with
// its campaign name, and a raw task document are all valid inputs.
// ============================================================

/**
 * Ascending SEVERITY, not alphabetical. The order is the data: `TASK_PRIORITIES`
 * is what `compareTasks` indexes into, so a select rendering it top-down
 * reverses this rather than hard-coding a second list that can drift.
 */
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Matches `tasks.status` in the schema. */
export type TaskStatus = 'todo' | 'done';

export type TaskSortKey = 'dueOn' | 'priority' | 'label' | 'assignee' | 'status' | 'project';

export const TASK_SORT_KEYS = [
	'dueOn',
	'priority',
	'label',
	'assignee',
	'status',
	'project'
] as const;

export type SortDir = 'asc' | 'desc';

/**
 * Who a task is assigned to. Polymorphic because the same person can be an org
 * member (a Better Auth user) or a contact — a client in the future portal has
 * only a contact record. Mirrors `tasks.assignee`.
 */
export type TaskAssignee =
	| { kind: 'user'; userId: string }
	| { kind: 'contact'; contactId: string };

/**
 * The assignee filter. `me` is stored as an INTENT rather than resolved to the
 * viewer's id at parse time, so a saved view or a pasted link means "assigned
 * to whoever is looking" for every viewer — which is the only reading that
 * makes a shared "My tasks" view useful.
 */
export type TaskAssigneeFilter =
	| { kind: 'me' }
	| { kind: 'unassigned' }
	| { kind: 'user'; userId: string }
	| { kind: 'contact'; contactId: string };

/**
 * The parsed filter state — the URL query string, typed. Every field except
 * `sort`/`dir` is optional-or-empty meaning "no constraint", so an absent
 * filter and a filter matching everything are the same thing and neither needs
 * a sentinel value.
 */
export interface TaskFilters {
	assignee?: TaskAssigneeFilter;
	/** Empty means any priority. Held in `TASK_PRIORITIES` order once parsed. */
	priority: TaskPriority[];
	/** `'all'` is a real choice — the default hides completed work. */
	status: TaskStatus | 'all';
	/** A `pipelineStages.key`. Immutable, so a renamed stage keeps its filter. */
	stageKey?: string;
	/** Only meaningful in the org-wide scope; the campaign page already has one. */
	campaignId?: string;
	/**
	 * The record a task belongs to. Campaign-scoped in the UI — a record never
	 * spans campaigns — but stored as a plain id so a saved view round-trips it
	 * like every other param.
	 */
	projectId?: string;
	/** ISO `YYYY-MM-DD`. Both bounds are INCLUSIVE — see `matchesFilters`. */
	dueAfter?: string;
	dueBefore?: string;
	sort: TaskSortKey;
	dir: SortDir;
}

/**
 * The structural row the comparators and `matchesFilters` read. `stageKey` and
 * `campaignId` are here because a filter names them, not because a comparator
 * sorts on them.
 */
export interface TaskLike {
	label: string;
	/** ISO `YYYY-MM-DD`, or absent. Absent is never "earliest" — see `compareTasks`. */
	dueOn?: string;
	priority: TaskPriority;
	status: TaskStatus;
	assignee?: TaskAssignee;
	stageKey?: string;
	campaignId?: string;
	projectId?: string;
	/**
	 * The record's DISPLAY number (P-001), which is what the record sort orders
	 * on — an id orders by insertion accident, where the number is what the
	 * column shows. Null as well as absent, because a hydrated row spells "no
	 * record" as null and a comparator should not need it re-spelled.
	 */
	projectNumber?: string | null;
}

/**
 * Rows per page the list offers, ascending. The FIRST is the default, so the
 * two facts live in one place rather than in a constant that can disagree with
 * the list it is meant to head.
 *
 * The largest is 100 because that is also the largest selection the bulk bar
 * will ever hold — selection is per page (see TaskListView) — and it stays
 * comfortably under the server's own `BULK_TASK_MAX`.
 */
export const TASK_PAGE_SIZES = [25, 50, 100] as const;

export type TaskPageSize = (typeof TASK_PAGE_SIZES)[number];

/**
 * Where in the list the reader is.
 *
 * SEPARATE from `TaskFilters` on purpose. A saved view stores the serialised
 * filters verbatim, and a view that remembered "page 3" would drop whoever
 * applied it into the middle of a list they have not seen the top of. Keeping
 * paging out of the filter type makes that impossible rather than merely
 * discouraged: `serializeTaskFilters` only writes `page`/`size` when a caller
 * hands it paging, and the saved-view path never does.
 */
export interface TaskPaging {
	/** 1-based, the way it reads in the URL and on the buttons. */
	page: number;
	size: TaskPageSize;
}

/**
 * Who is looking, for resolving `assignee=me`.
 *
 * Two ids because one person is reachable two ways: tasks assigned to their org
 * member account, and tasks assigned to the contact record linked to it via
 * `contacts.authUserId`. Resolving that link needs a db read, so the caller
 * does it once and passes the result down; the RULE for what counts as "mine"
 * lives here, written once, per the spec's second risk.
 */
export interface TaskViewer {
	/** Better Auth user id. */
	userId?: string;
	/** The contact whose `authUserId` is this viewer, when the link exists. */
	contactId?: string;
}
