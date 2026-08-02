// ============================================================
// Task filters — the URL query string, parsed, serialised and applied
// ============================================================
// Filters and sort live in the URL (see the spec's State Design): a filtered
// list is a link, and a saved view is literally "the URL I had", stored
// verbatim. That only holds if parse and serialise are exact inverses, so the
// round trip is the first thing the tests assert.
//
// PURE on purpose. Both pages, the saved-view list and the server handler that
// applies whatever the index could not all run this same code, so it imports
// no Convex, no Svelte and reads no clock. `today` is a parameter of
// `isOverdue` for the reason the spec gives: a Convex query that reads the
// clock goes stale with no write and poisons the query cache.
//
// Every parser is TOLERANT. A query string arrives from a hand-edited URL, a
// saved view written by an older build, or a link pasted out of Slack. An
// unrecognised sort key or priority falls back to the default rather than
// throwing — a broken filter should show the default list, not a stack trace.
// ============================================================

import {
	TASK_PAGE_SIZES,
	TASK_PRIORITIES,
	TASK_SORT_KEYS,
	type SortDir,
	type TaskAssignee,
	type TaskAssigneeFilter,
	type TaskFilters,
	type TaskLike,
	type TaskPageSize,
	type TaskPaging,
	type TaskPriority,
	type TaskSortKey,
	type TaskStatus,
	type TaskViewer
} from './types';

/**
 * Sort by due date ascending — the nearest deadline first — and hide completed
 * work. Frozen because it is shared: a caller that mutated it would change the
 * default list for every other caller in the tab. Spread it to derive.
 */
export const DEFAULT_TASK_FILTERS: TaskFilters = Object.freeze({
	priority: [] as TaskPriority[],
	status: 'todo' as const,
	sort: 'dueOn' as const,
	dir: 'asc' as const
});

/**
 * Page one, twenty-five rows. Frozen for the same reason the filters are: it is
 * shared, and a caller that mutated it would repaginate every other list in the
 * tab.
 */
export const DEFAULT_TASK_PAGING: TaskPaging = Object.freeze({
	page: 1,
	size: TASK_PAGE_SIZES[0]
});

/** Matching `dueOn` in the schema: a calendar day, zero-padded, never an instant. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A page number is digits and nothing else — not '2.5', not '2e3', not ' 2 '. */
const PAGE_NUMBER = /^\d+$/;

// The `assignee` param is prefixed rather than bare because a user id and a
// contact id are both opaque strings — nothing in the id itself says which
// table it belongs to. `me` and `unassigned` are unprefixed because they name
// no id at all and read well in a shared link.
const USER_PREFIX = 'user:';
const CONTACT_PREFIX = 'contact:';

// ------------------------------------------------------------------
// Parse
// ------------------------------------------------------------------

/** The URL query string, typed. Junk falls back to the default, never throws. */
export function parseTaskQuery(search: URLSearchParams | string): TaskFilters {
	// URLSearchParams strips a leading '?' itself, so `page.url.search` and a
	// bare 'a=b' are both accepted without the caller having to know which.
	const params = typeof search === 'string' ? new URLSearchParams(search) : search;

	const filters: TaskFilters = {
		priority: parsePriorities(params.getAll('priority')),
		status: parseStatus(params.get('status')),
		sort: parseSortKey(params.get('sort')),
		dir: params.get('dir') === 'desc' ? 'desc' : 'asc'
	};

	const assignee = parseAssignee(params.get('assignee'));
	if (assignee) filters.assignee = assignee;

	const stageKey = cleanString(params.get('stage'));
	if (stageKey) filters.stageKey = stageKey;

	const campaignId = cleanString(params.get('campaign'));
	if (campaignId) filters.campaignId = campaignId;

	const projectId = cleanString(params.get('project'));
	if (projectId) filters.projectId = projectId;

	const dueAfter = parseIsoDate(params.get('dueAfter'));
	if (dueAfter) filters.dueAfter = dueAfter;

	const dueBefore = parseIsoDate(params.get('dueBefore'));
	if (dueBefore) filters.dueBefore = dueBefore;

	return filters;
}

/**
 * Where in the list the URL says we are.
 *
 * A SECOND parser rather than two more fields on `parseTaskQuery`, because the
 * two answers have different lifetimes: the filters describe a list and get
 * saved as a view, where the page describes a position in one and must not be.
 * Keeping them apart is what lets the saved-view code go on calling
 * `serializeTaskFilters(filters)` and get the same clean string it always did.
 *
 * Tolerant like every other parser here: `?page=banana`, `?page=0` and
 * `?page=-3` all mean page one rather than an error, and a size the list does
 * not offer falls back to the default rather than rendering a page length
 * nothing in the UI can undo.
 */
export function parseTaskPaging(search: URLSearchParams | string): TaskPaging {
	const params = typeof search === 'string' ? new URLSearchParams(search) : search;
	return {
		page: parsePageNumber(params.get('page')),
		size: parsePageSize(params.get('size'))
	};
}

function parsePageNumber(value: string | null): number {
	const trimmed = cleanString(value);
	if (!trimmed || !PAGE_NUMBER.test(trimmed)) return DEFAULT_TASK_PAGING.page;
	const parsed = Number.parseInt(trimmed, 10);
	// Past the safe-integer range the arithmetic downstream stops being exact,
	// and no list has that many pages anyway. A page beyond the last one is NOT
	// rejected here though — it is clamped where the row count is known.
	if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_TASK_PAGING.page;
	return parsed;
}

function parsePageSize(value: string | null): TaskPageSize {
	const trimmed = cleanString(value);
	const parsed = trimmed && PAGE_NUMBER.test(trimmed) ? Number.parseInt(trimmed, 10) : NaN;
	return TASK_PAGE_SIZES.find((size) => size === parsed) ?? DEFAULT_TASK_PAGING.size;
}

function cleanString(value: string | null): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function parseIsoDate(value: string | null): string | undefined {
	const trimmed = cleanString(value);
	// Shape only. A calendar-impossible day (2026-02-31) still compares
	// sensibly against other ISO strings, and rejecting it here would mean
	// reimplementing a date library in a filter parser.
	return trimmed && ISO_DATE.test(trimmed) ? trimmed : undefined;
}

/**
 * Accepts both `priority=high&priority=urgent` and `priority=high,urgent` —
 * the first is what we write, the second is what a person hand-editing a URL
 * tends to write. Unknown values are dropped rather than failing the whole
 * param, so one typo does not discard the filter the user got right.
 *
 * The result is deduped and held in severity order so two URLs naming the same
 * set parse to the same value and serialise back identically.
 */
function parsePriorities(values: string[]): TaskPriority[] {
	const seen = new Set<string>();
	for (const value of values) {
		for (const part of value.split(',')) {
			seen.add(part.trim().toLowerCase());
		}
	}
	return TASK_PRIORITIES.filter((priority) => seen.has(priority));
}

function parseStatus(value: string | null): TaskStatus | 'all' {
	const trimmed = cleanString(value);
	if (trimmed === 'all' || trimmed === 'done' || trimmed === 'todo') return trimmed;
	return DEFAULT_TASK_FILTERS.status;
}

function parseSortKey(value: string | null): TaskSortKey {
	const trimmed = cleanString(value);
	return TASK_SORT_KEYS.find((key) => key === trimmed) ?? DEFAULT_TASK_FILTERS.sort;
}

function parseAssignee(value: string | null): TaskAssigneeFilter | undefined {
	const trimmed = cleanString(value);
	if (!trimmed) return undefined;
	if (trimmed === 'me') return { kind: 'me' };
	if (trimmed === 'unassigned') return { kind: 'unassigned' };
	if (trimmed.startsWith(USER_PREFIX)) {
		const userId = trimmed.slice(USER_PREFIX.length);
		return userId ? { kind: 'user', userId } : undefined;
	}
	if (trimmed.startsWith(CONTACT_PREFIX)) {
		const contactId = trimmed.slice(CONTACT_PREFIX.length);
		return contactId ? { kind: 'contact', contactId } : undefined;
	}
	// An unprefixed id names no table, so it cannot be applied safely.
	return undefined;
}

// ------------------------------------------------------------------
// Serialise
// ------------------------------------------------------------------

/**
 * The inverse of `parseTaskQuery` (and, with `paging`, of `parseTaskPaging`),
 * without a leading '?'.
 *
 * Defaults are OMITTED so an unfiltered list has a clean URL — otherwise every
 * page load would rewrite the address bar with `?status=todo&sort=dueOn&dir=asc`
 * and every saved view would store noise. Page one omits `page` for exactly the
 * same reason. Params are written in a fixed order so the same filters always
 * produce byte-identical output; a saved view's stored query is compared as a
 * string when deciding which view is active.
 *
 * `paging` is OPTIONAL and written last. A caller that omits it — the saved-view
 * code does — gets the filters alone, byte for byte what this function returned
 * before paging existed, so views written by earlier builds still match.
 */
export function serializeTaskFilters(filters: TaskFilters, paging?: TaskPaging): string {
	const params = new URLSearchParams();

	if (filters.assignee) params.set('assignee', serializeAssignee(filters.assignee));

	// Repeated params rather than a comma list: URLSearchParams percent-encodes
	// a comma, and `priority=high&priority=urgent` stays readable in the bar.
	for (const priority of TASK_PRIORITIES) {
		if (filters.priority.includes(priority)) params.append('priority', priority);
	}

	if (filters.status !== DEFAULT_TASK_FILTERS.status) params.set('status', filters.status);
	if (filters.stageKey) params.set('stage', filters.stageKey);
	if (filters.campaignId) params.set('campaign', filters.campaignId);
	if (filters.projectId) params.set('project', filters.projectId);
	if (filters.dueAfter) params.set('dueAfter', filters.dueAfter);
	if (filters.dueBefore) params.set('dueBefore', filters.dueBefore);
	if (filters.sort !== DEFAULT_TASK_FILTERS.sort) params.set('sort', filters.sort);
	if (filters.dir !== DEFAULT_TASK_FILTERS.dir) params.set('dir', filters.dir);

	if (paging) {
		if (paging.page > DEFAULT_TASK_PAGING.page) params.set('page', String(paging.page));
		if (paging.size !== DEFAULT_TASK_PAGING.size) params.set('size', String(paging.size));
	}

	return params.toString();
}

/**
 * Where paging lands when the filters or the sort change: back at page one,
 * keeping the page size.
 *
 * This is THE pagination bug, written down so it cannot be forgotten at a call
 * site. Narrowing to three results while sitting on page five shows an empty
 * table under a filter bar that says rows exist, and it reads as broken data
 * rather than as a stale page number. Every navigation that changes what the
 * list contains goes through here.
 *
 * The SIZE survives, because it is a preference about how much of the list to
 * read at once — the same reasoning that keeps the sort when filters are
 * cleared — and because resetting it would silently undo a choice the reader
 * made on purpose.
 */
export function resetTaskPaging(paging: TaskPaging): TaskPaging {
	// Returned unchanged when it is already page one, so an unchanged value is
	// referentially unchanged and a `$derived` reading it does not churn.
	return paging.page === DEFAULT_TASK_PAGING.page ? paging : { ...paging, page: 1 };
}

function serializeAssignee(assignee: TaskAssigneeFilter): string {
	switch (assignee.kind) {
		case 'me':
		case 'unassigned':
			return assignee.kind;
		case 'user':
			return `${USER_PREFIX}${assignee.userId}`;
		case 'contact':
			return `${CONTACT_PREFIX}${assignee.contactId}`;
	}
}

/**
 * Whether anything NARROWS the list. Sort is excluded deliberately: the two
 * empty states differ by whether clearing the filters would bring rows back,
 * and re-sorting an empty list brings nothing back.
 */
export function hasActiveTaskFilters(filters: TaskFilters): boolean {
	return Boolean(
		filters.assignee ||
		filters.priority.length ||
		filters.status !== DEFAULT_TASK_FILTERS.status ||
		filters.stageKey ||
		filters.campaignId ||
		filters.projectId ||
		filters.dueAfter ||
		filters.dueBefore
	);
}

// ------------------------------------------------------------------
// Sort
// ------------------------------------------------------------------

const PRIORITY_RANK: Record<TaskPriority, number> = {
	low: 0,
	normal: 1,
	high: 2,
	urgent: 3
};

// Open work first when ascending. "Sort by status" is asked for to bring the
// unfinished rows up, never to admire the completed ones.
const STATUS_RANK: Record<TaskStatus, number> = { todo: 0, done: 1 };

/**
 * Order two tasks by one column.
 *
 * The invariant worth stating: an ABSENT value sorts last in BOTH directions.
 * A task with no due date is not due first — reversing the sort to see the
 * furthest deadlines should not fill the top of the table with undated rows,
 * and the same reading applies to unassigned rows under an assignee sort and to
 * campaign-level rows under a record sort. So the direction flips only the
 * comparison between two present values.
 *
 * Ties break on label ascending regardless of direction, so a table of tasks
 * that all share a due date has a stable, readable order rather than whatever
 * the query happened to return.
 */
export function compareTasks(
	a: TaskLike,
	b: TaskLike,
	sort: TaskSortKey = DEFAULT_TASK_FILTERS.sort,
	dir: SortDir = DEFAULT_TASK_FILTERS.dir
): number {
	const flip = dir === 'desc' ? -1 : 1;

	switch (sort) {
		case 'dueOn': {
			if (!a.dueOn || !b.dueOn) {
				if (a.dueOn) return -1;
				if (b.dueOn) return 1;
				return byLabel(a, b);
			}
			// ISO dates compare correctly as strings — that is most of why the
			// column is stored as one.
			return flip * compareStrings(a.dueOn, b.dueOn) || byLabel(a, b);
		}
		case 'priority':
			// Severity, not the alphabet: 'urgent' before 'low' ascending would
			// otherwise land between 'normal' and nothing useful at all.
			return flip * (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || byLabel(a, b);
		case 'status':
			return flip * (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || byLabel(a, b);
		case 'assignee': {
			const left = assigneeSortKey(a.assignee);
			const right = assigneeSortKey(b.assignee);
			if (!left || !right) {
				if (left) return -1;
				if (right) return 1;
				return byLabel(a, b);
			}
			return flip * compareStrings(left, right) || byLabel(a, b);
		}
		case 'project': {
			// A campaign-level task belongs to no record at all, so it sorts last
			// in both directions — the same reading as an undated row, and the
			// reason it is not simply "the empty string sorts first".
			const left = a.projectNumber ?? '';
			const right = b.projectNumber ?? '';
			if (!left || !right) {
				if (left) return -1;
				if (right) return 1;
				return byLabel(a, b);
			}
			return flip * compareNumbers(left, right) || byLabel(a, b);
		}
		case 'label':
			return flip * compareStrings(a.label, b.label);
	}
}

/**
 * Assignee ordering is by id, not by name — this module has no name to sort on
 * and refuses to invent one by importing a member list. The effect is that the
 * column GROUPS a person's tasks together, which is what the sort is for; a
 * caller wanting alphabetical-by-name sorts on a resolved list itself.
 */
function assigneeSortKey(assignee: TaskAssignee | undefined): string {
	if (!assignee) return '';
	return assignee.kind === 'user' ? `user:${assignee.userId}` : `contact:${assignee.contactId}`;
}

function byLabel(a: TaskLike, b: TaskLike): number {
	return compareStrings(a.label, b.label);
}

/** `localeCompare` so accented labels sort where a reader expects, not by code point. */
function compareStrings(a: string, b: string): number {
	return a.localeCompare(b);
}

/**
 * A record number is a prefix and a counter — P-009, P-010 — and the counter is
 * only padded to three digits. A plain string compare would file P-1000 between
 * P-1 and P-2 the day a campaign passes its thousandth record.
 */
function compareNumbers(a: string, b: string): number {
	return a.localeCompare(b, undefined, { numeric: true });
}

// ------------------------------------------------------------------
// Apply
// ------------------------------------------------------------------

/**
 * Is this task past due? `today` is an ISO `YYYY-MM-DD` supplied by the CALLER
 * — the client knows the viewer's timezone and this module deliberately never
 * reads the clock (a Convex query that did would go stale with no write, and
 * would poison the query cache).
 *
 * Due TODAY is not overdue: a day is a deadline, and it has not passed until
 * it is over. A completed task is never overdue no matter when it was due.
 */
export function isOverdue(task: TaskLike, today: string): boolean {
	if (!task.dueOn || task.status === 'done') return false;
	return task.dueOn < today;
}

/**
 * Does this task survive the filters?
 *
 * `viewer` resolves `assignee=me` and accepts a bare user id for the common
 * case. The rule lives here, once: a task is mine if it is assigned to my user
 * account OR to the contact record linked to it (`contacts.authUserId`). The
 * caller resolves that link — it needs a db read — and passes both ids down;
 * re-deriving "mine" at each call site is exactly the drift the spec warns of.
 */
export function matchesFilters(
	task: TaskLike,
	filters: TaskFilters,
	viewer?: TaskViewer | string
): boolean {
	if (filters.status !== 'all' && task.status !== filters.status) return false;
	if (filters.priority.length && !filters.priority.includes(task.priority)) return false;
	if (filters.stageKey && task.stageKey !== filters.stageKey) return false;
	if (filters.campaignId && task.campaignId !== filters.campaignId) return false;
	// A campaign-level task belongs to no record, so it is in no record's list.
	if (filters.projectId && task.projectId !== filters.projectId) return false;

	// An undated task is in no date range. It has no date to be inside one, and
	// showing it under "due this week" would make the range meaningless.
	if (filters.dueAfter && (!task.dueOn || task.dueOn < filters.dueAfter)) return false;
	if (filters.dueBefore && (!task.dueOn || task.dueOn > filters.dueBefore)) return false;

	if (filters.assignee && !matchesAssignee(task.assignee, filters.assignee, viewer)) return false;

	return true;
}

function matchesAssignee(
	assignee: TaskAssignee | undefined,
	filter: TaskAssigneeFilter,
	viewer?: TaskViewer | string
): boolean {
	switch (filter.kind) {
		case 'unassigned':
			return !assignee;
		case 'me':
			return isAssignedToViewer(assignee, viewer);
		case 'user':
			return assignee?.kind === 'user' && assignee.userId === filter.userId;
		case 'contact':
			return assignee?.kind === 'contact' && assignee.contactId === filter.contactId;
	}
}

/** The one definition of "assigned to me". See `matchesFilters`. */
export function isAssignedToViewer(
	assignee: TaskAssignee | undefined,
	viewer?: TaskViewer | string
): boolean {
	if (!assignee) return false;
	const identity: TaskViewer = typeof viewer === 'string' ? { userId: viewer } : (viewer ?? {});
	// An unknown viewer matches nothing — never everything. Getting this
	// backwards would show a signed-out or unresolved viewer the whole list
	// under a "My tasks" heading.
	if (assignee.kind === 'user')
		return Boolean(identity.userId) && assignee.userId === identity.userId;
	return Boolean(identity.contactId) && assignee.contactId === identity.contactId;
}
