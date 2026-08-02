import { describe, expect, it } from 'vitest';

import {
	compareTasks,
	DEFAULT_TASK_FILTERS,
	DEFAULT_TASK_PAGING,
	hasActiveTaskFilters,
	isAssignedToViewer,
	isOverdue,
	matchesFilters,
	parseTaskPaging,
	parseTaskQuery,
	resetTaskPaging,
	serializeTaskFilters
} from './filters';
import { TASK_PRIORITIES, type TaskFilters, type TaskLike } from './types';

function task(overrides: Partial<TaskLike> = {}): TaskLike {
	return {
		label: 'Collect documents',
		priority: 'normal',
		status: 'todo',
		...overrides
	};
}

function filters(overrides: Partial<TaskFilters> = {}): TaskFilters {
	return { ...DEFAULT_TASK_FILTERS, priority: [], ...overrides };
}

describe('parseTaskQuery / serializeTaskFilters', () => {
	it('an empty query is the defaults, and the defaults are an empty query', () => {
		expect(parseTaskQuery('')).toEqual(filters());
		expect(serializeTaskFilters(filters())).toBe('');
	});

	it('accepts a query string with or without its leading ?', () => {
		expect(parseTaskQuery('?assignee=me')).toEqual(parseTaskQuery('assignee=me'));
	});

	it('accepts a URLSearchParams as well as a string', () => {
		const params = new URLSearchParams('status=all&sort=priority&dir=desc');
		expect(parseTaskQuery(params)).toEqual(parseTaskQuery('status=all&sort=priority&dir=desc'));
	});

	it('round-trips every field', () => {
		const original = filters({
			assignee: { kind: 'contact', contactId: 'k17abc' },
			priority: ['high', 'urgent'],
			status: 'all',
			stageKey: 'vetted',
			campaignId: 'j99xyz',
			projectId: 'p42def',
			dueAfter: '2026-01-01',
			dueBefore: '2026-12-31',
			sort: 'label',
			dir: 'desc'
		});

		expect(parseTaskQuery(serializeTaskFilters(original))).toEqual(original);
	});

	it('round-trips each assignee kind, including the id-bearing ones', () => {
		for (const assignee of [
			{ kind: 'me' },
			{ kind: 'unassigned' },
			{ kind: 'user', userId: 'usr_1' },
			{ kind: 'contact', contactId: 'con_1' }
		] as const) {
			const original = filters({ assignee });
			expect(parseTaskQuery(serializeTaskFilters(original))).toEqual(original);
		}
	});

	it('omits the defaults so a clean list has a clean URL', () => {
		const query = serializeTaskFilters(filters({ priority: ['high'] }));
		expect(query).toBe('priority=high');
	});

	it('writes the documented shape', () => {
		const query = serializeTaskFilters(
			filters({ assignee: { kind: 'me' }, priority: ['high'], sort: 'dueOn', dir: 'asc' })
		);
		expect(query).toBe('assignee=me&priority=high');
	});

	it('names the record filter `project` in the URL', () => {
		// The param is part of the contract: a saved view stores this string, so
		// renaming it silently breaks every view already written.
		expect(serializeTaskFilters(filters({ projectId: 'p42def' }))).toBe('project=p42def');
		expect(parseTaskQuery('project=p42def').projectId).toBe('p42def');
	});

	it('normalises the priority list, so two spellings of one set are one URL', () => {
		// Order and duplicates in the URL must not survive, or a saved view
		// stored as a string would stop matching the filters it describes.
		const parsed = parseTaskQuery('priority=urgent&priority=low&priority=urgent');
		expect(parsed.priority).toEqual(['low', 'urgent']);
		expect(serializeTaskFilters(parsed)).toBe('priority=low&priority=urgent');
	});

	it('also accepts a hand-written comma list', () => {
		expect(parseTaskQuery('priority=high,urgent').priority).toEqual(['high', 'urgent']);
	});
});

describe('parseTaskQuery tolerance', () => {
	it('falls back to the default sort and direction rather than throwing', () => {
		const parsed = parseTaskQuery('sort=nonsense&dir=sideways');
		expect(parsed.sort).toBe('dueOn');
		expect(parsed.dir).toBe('asc');
	});

	it('drops unknown priorities but keeps the recognised ones', () => {
		expect(parseTaskQuery('priority=high,banana').priority).toEqual(['high']);
		expect(parseTaskQuery('priority=banana').priority).toEqual([]);
	});

	it('falls back to the default status', () => {
		expect(parseTaskQuery('status=maybe').status).toBe('todo');
	});

	it('ignores an assignee that names no table', () => {
		// A bare id cannot be applied: nothing in the string says whether it is
		// a user or a contact.
		expect(parseTaskQuery('assignee=k17abc').assignee).toBeUndefined();
		expect(parseTaskQuery('assignee=user:').assignee).toBeUndefined();
	});

	it('ignores dates that are not ISO calendar days', () => {
		expect(parseTaskQuery('dueBefore=next+friday').dueBefore).toBeUndefined();
		expect(parseTaskQuery('dueAfter=2026-3-4').dueAfter).toBeUndefined();
		expect(parseTaskQuery('dueAfter=2026-03-04').dueAfter).toBe('2026-03-04');
	});

	it('ignores blank and whitespace-only values', () => {
		const parsed = parseTaskQuery('stage=++&campaign=&project=+&assignee=+');
		expect(parsed.stageKey).toBeUndefined();
		expect(parsed.campaignId).toBeUndefined();
		expect(parsed.projectId).toBeUndefined();
		expect(parsed.assignee).toBeUndefined();
	});

	it('survives junk in every field at once', () => {
		expect(parseTaskQuery('sort=&dir=&status=&priority=&assignee=&stage=&dueOn=today')).toEqual(
			filters()
		);
	});
});

describe('parseTaskPaging / serializeTaskFilters paging', () => {
	it('page one at the default size is an empty query', () => {
		expect(parseTaskPaging('')).toEqual(DEFAULT_TASK_PAGING);
		expect(serializeTaskFilters(filters(), DEFAULT_TASK_PAGING)).toBe('');
	});

	it('round-trips a page and a size', () => {
		for (const paging of [
			{ page: 3, size: 25 },
			{ page: 1, size: 100 },
			{ page: 12, size: 50 }
		] as const) {
			expect(parseTaskPaging(serializeTaskFilters(filters(), paging))).toEqual(paging);
		}
	});

	it('round-trips paging alongside the filters, in the documented order', () => {
		const original = filters({ priority: ['high'], sort: 'label', dir: 'desc' });
		const paging = { page: 4, size: 100 } as const;
		const query = serializeTaskFilters(original, paging);

		expect(query).toBe('priority=high&sort=label&dir=desc&page=4&size=100');
		expect(parseTaskQuery(query)).toEqual(original);
		expect(parseTaskPaging(query)).toEqual(paging);
	});

	it('never writes paging when the caller does not ask for it', () => {
		// This is what a SAVED VIEW stores. A view that remembered "page 3" would
		// drop whoever applied it into the middle of a list they have not seen the
		// top of, and applying one must always land on page one.
		expect(serializeTaskFilters(filters({ priority: ['high'] }))).toBe('priority=high');
	});

	it('leaves the filters alone: a page param is not a filter', () => {
		expect(parseTaskQuery('page=7&size=50')).toEqual(filters());
		expect(hasActiveTaskFilters(parseTaskQuery('page=7&size=50'))).toBe(false);
	});

	it('falls back to page one rather than throwing on junk', () => {
		for (const query of [
			'page=0',
			'page=-3',
			'page=banana',
			'page=2.5',
			'page=',
			'page= ',
			'page=1e3',
			'page=99999999999999999999'
		]) {
			expect(parseTaskPaging(query).page).toBe(1);
		}
	});

	it('falls back to the default size for one the list does not offer', () => {
		expect(parseTaskPaging('size=13').size).toBe(DEFAULT_TASK_PAGING.size);
		expect(parseTaskPaging('size=0').size).toBe(DEFAULT_TASK_PAGING.size);
		expect(parseTaskPaging('size=nonsense').size).toBe(DEFAULT_TASK_PAGING.size);
		// The offered ones do survive, or the fallback would be hiding a bug.
		expect(parseTaskPaging('size=100').size).toBe(100);
	});
});

describe('resetTaskPaging', () => {
	it('sends a filter or sort change back to page one', () => {
		// THE pagination bug: narrowing to three results while sitting on page five
		// shows an empty table under a filter bar that says rows exist.
		expect(resetTaskPaging({ page: 5, size: 25 })).toEqual({ page: 1, size: 25 });
	});

	it('keeps the page size, which is a preference and not a constraint', () => {
		expect(resetTaskPaging({ page: 5, size: 100 })).toEqual({ page: 1, size: 100 });
	});

	it('drops the page param from the query a filter change navigates to', () => {
		// The rule as the URL sees it: this is exactly what `applyFilters` writes.
		const next = filters({ priority: ['urgent'] });
		expect(serializeTaskFilters(next, resetTaskPaging({ page: 5, size: 50 }))).toBe(
			'priority=urgent&size=50'
		);
		expect(
			parseTaskPaging(serializeTaskFilters(next, resetTaskPaging({ page: 5, size: 50 })))
		).toEqual({ page: 1, size: 50 });
	});

	it('leaves page one untouched, so an unchanged value stays unchanged', () => {
		const paging = { page: 1, size: 50 } as const;
		expect(resetTaskPaging(paging)).toBe(paging);
	});
});

describe('hasActiveTaskFilters', () => {
	it('is false for the defaults and true for anything that narrows the list', () => {
		expect(hasActiveTaskFilters(filters())).toBe(false);
		expect(hasActiveTaskFilters(filters({ priority: ['high'] }))).toBe(true);
		expect(hasActiveTaskFilters(filters({ status: 'all' }))).toBe(true);
		expect(hasActiveTaskFilters(filters({ projectId: 'p42def' }))).toBe(true);
	});

	it('ignores sort, which cannot be why a list looks empty', () => {
		expect(hasActiveTaskFilters(filters({ sort: 'label', dir: 'desc' }))).toBe(false);
	});
});

describe('compareTasks by dueOn', () => {
	const early = task({ label: 'Early', dueOn: '2026-01-05' });
	const late = task({ label: 'Late', dueOn: '2026-06-05' });
	const undated = task({ label: 'Undated' });

	it('sorts nearest deadline first ascending', () => {
		expect(compareTasks(early, late, 'dueOn', 'asc')).toBeLessThan(0);
		expect(compareTasks(late, early, 'dueOn', 'asc')).toBeGreaterThan(0);
	});

	it('reverses for descending', () => {
		expect(compareTasks(early, late, 'dueOn', 'desc')).toBeGreaterThan(0);
	});

	it('puts an undated task last ASCENDING', () => {
		expect(compareTasks(undated, late, 'dueOn', 'asc')).toBeGreaterThan(0);
		expect(compareTasks(late, undated, 'dueOn', 'asc')).toBeLessThan(0);
	});

	it('puts an undated task last DESCENDING too — absent is not "earliest"', () => {
		expect(compareTasks(undated, early, 'dueOn', 'desc')).toBeGreaterThan(0);
		expect(compareTasks(early, undated, 'dueOn', 'desc')).toBeLessThan(0);
	});

	it('keeps undated rows at the bottom of a full sort in both directions', () => {
		const rows = [undated, late, early];
		const asc = [...rows].sort((a, b) => compareTasks(a, b, 'dueOn', 'asc'));
		const desc = [...rows].sort((a, b) => compareTasks(a, b, 'dueOn', 'desc'));

		expect(asc.map((row) => row.label)).toEqual(['Early', 'Late', 'Undated']);
		expect(desc.map((row) => row.label)).toEqual(['Late', 'Early', 'Undated']);
	});

	it('breaks ties on label ascending, whichever way the column is sorted', () => {
		const a = task({ label: 'Apply', dueOn: '2026-01-05' });
		const z = task({ label: 'Zip', dueOn: '2026-01-05' });
		expect(compareTasks(z, a, 'dueOn', 'asc')).toBeGreaterThan(0);
		expect(compareTasks(z, a, 'dueOn', 'desc')).toBeGreaterThan(0);
	});
});

describe('compareTasks by priority', () => {
	it('orders by severity, not alphabetically', () => {
		const sorted = TASK_PRIORITIES.map((priority) => task({ label: priority, priority }))
			.sort((a, b) => compareTasks(a, b, 'priority', 'asc'))
			.map((row) => row.priority);

		expect(sorted).toEqual(['low', 'normal', 'high', 'urgent']);
	});

	it('puts urgent on top when reversed — the useful direction', () => {
		const sorted = TASK_PRIORITIES.map((priority) => task({ label: priority, priority }))
			.sort((a, b) => compareTasks(a, b, 'priority', 'desc'))
			.map((row) => row.priority);

		expect(sorted).toEqual(['urgent', 'high', 'normal', 'low']);
	});

	it('does not fall into alphabetical order', () => {
		// 'urgent' < 'low' by severity is the whole point; alphabetically it is
		// the other way round, which is what a naive string compare would give.
		expect(
			compareTasks(task({ priority: 'urgent' }), task({ priority: 'low' }), 'priority', 'asc')
		).toBeGreaterThan(0);
	});
});

describe('compareTasks by project', () => {
	const first = task({ label: 'First', projectNumber: 'P-001' });
	const later = task({ label: 'Later', projectNumber: 'P-012' });
	const campaignLevel = task({ label: 'Campaign-level' });

	it('orders by the record NUMBER, ascending by default', () => {
		expect(compareTasks(first, later, 'project', 'asc')).toBeLessThan(0);
		expect(compareTasks(later, first, 'project', 'asc')).toBeGreaterThan(0);
	});

	it('reverses for descending', () => {
		expect(compareTasks(first, later, 'project', 'desc')).toBeGreaterThan(0);
	});

	it('counts past the padding, so P-1000 follows P-999', () => {
		const padded = task({ label: 'Padded', projectNumber: 'P-999' });
		const beyond = task({ label: 'Beyond', projectNumber: 'P-1000' });
		expect(compareTasks(padded, beyond, 'project', 'asc')).toBeLessThan(0);
	});

	it('puts a campaign-level task last ASCENDING', () => {
		expect(compareTasks(campaignLevel, first, 'project', 'asc')).toBeGreaterThan(0);
		expect(compareTasks(first, campaignLevel, 'project', 'asc')).toBeLessThan(0);
	});

	it('puts a campaign-level task last DESCENDING too — no record is not "lowest"', () => {
		expect(compareTasks(campaignLevel, first, 'project', 'desc')).toBeGreaterThan(0);
		expect(compareTasks(first, campaignLevel, 'project', 'desc')).toBeLessThan(0);
	});

	it('keeps campaign-level rows at the bottom of a full sort in both directions', () => {
		const rows = [campaignLevel, later, first];
		const asc = [...rows].sort((a, b) => compareTasks(a, b, 'project', 'asc'));
		const desc = [...rows].sort((a, b) => compareTasks(a, b, 'project', 'desc'));

		expect(asc.map((row) => row.label)).toEqual(['First', 'Later', 'Campaign-level']);
		expect(desc.map((row) => row.label)).toEqual(['Later', 'First', 'Campaign-level']);
	});

	it('treats a null number as no record — a hydrated row spells it that way', () => {
		expect(
			compareTasks(task({ label: 'Null', projectNumber: null }), first, 'project', 'asc')
		).toBeGreaterThan(0);
	});

	it('breaks ties on label, so one record’s tasks read in a stable order', () => {
		const a = task({ label: 'Apply', projectNumber: 'P-001' });
		const z = task({ label: 'Zip', projectNumber: 'P-001' });
		expect(compareTasks(z, a, 'project', 'asc')).toBeGreaterThan(0);
		expect(compareTasks(z, a, 'project', 'desc')).toBeGreaterThan(0);
	});
});

describe('compareTasks by label, status and assignee', () => {
	it('sorts labels with localeCompare, not by code point', () => {
		const rows = [task({ label: 'Zebra' }), task({ label: 'école' }), task({ label: 'Apple' })];
		const sorted = [...rows]
			.sort((a, b) => compareTasks(a, b, 'label', 'asc'))
			.map((row) => row.label);

		// A code-point sort would strand 'école' after 'Zebra'.
		expect(sorted).toEqual(['Apple', 'école', 'Zebra']);
	});

	it('brings open work up ascending', () => {
		const todo = task({ label: 'Open', status: 'todo' });
		const done = task({ label: 'Closed', status: 'done' });
		expect(compareTasks(todo, done, 'status', 'asc')).toBeLessThan(0);
		expect(compareTasks(todo, done, 'status', 'desc')).toBeGreaterThan(0);
	});

	it('sorts unassigned last in both directions, like an absent due date', () => {
		const assigned = task({ label: 'Assigned', assignee: { kind: 'user', userId: 'usr_1' } });
		const unassigned = task({ label: 'Nobody' });
		expect(compareTasks(unassigned, assigned, 'assignee', 'asc')).toBeGreaterThan(0);
		expect(compareTasks(unassigned, assigned, 'assignee', 'desc')).toBeGreaterThan(0);
	});

	it('groups one person’s tasks together', () => {
		const first = task({ label: 'B', assignee: { kind: 'user', userId: 'usr_1' } });
		const second = task({ label: 'A', assignee: { kind: 'user', userId: 'usr_1' } });
		expect(compareTasks(first, second, 'assignee', 'asc')).toBeGreaterThan(0); // tie → label
		expect(
			compareTasks(first, task({ assignee: { kind: 'user', userId: 'usr_2' } }), 'assignee', 'asc')
		).toBeLessThan(0);
	});

	it('defaults to the default sort when none is given', () => {
		const early = task({ label: 'Early', dueOn: '2026-01-05' });
		const late = task({ label: 'Late', dueOn: '2026-06-05' });
		expect(compareTasks(early, late)).toBeLessThan(0);
	});
});

describe('isOverdue', () => {
	const today = '2026-08-01';

	it('is true only once the day has passed', () => {
		expect(isOverdue(task({ dueOn: '2026-07-31' }), today)).toBe(true);
	});

	it('is false for a task due TODAY — a deadline has not passed until the day is over', () => {
		expect(isOverdue(task({ dueOn: today }), today)).toBe(false);
	});

	it('is false for a task due tomorrow', () => {
		expect(isOverdue(task({ dueOn: '2026-08-02' }), today)).toBe(false);
	});

	it('is false for an undated task', () => {
		expect(isOverdue(task(), today)).toBe(false);
	});

	it('is false for completed work, however late it was', () => {
		expect(isOverdue(task({ dueOn: '2020-01-01', status: 'done' }), today)).toBe(false);
	});

	it('crosses year and month boundaries by string compare alone', () => {
		expect(isOverdue(task({ dueOn: '2025-12-31' }), '2026-01-01')).toBe(true);
		expect(isOverdue(task({ dueOn: '2026-01-01' }), '2025-12-31')).toBe(false);
	});
});

describe('matchesFilters', () => {
	const mine = task({ assignee: { kind: 'user', userId: 'usr_me' } });
	const theirs = task({ assignee: { kind: 'user', userId: 'usr_other' } });
	const myContact = task({ assignee: { kind: 'contact', contactId: 'con_me' } });
	const nobody = task();

	it('hides completed work by default and shows it under status=all', () => {
		const done = task({ status: 'done' });
		expect(matchesFilters(done, filters())).toBe(false);
		expect(matchesFilters(done, filters({ status: 'all' }))).toBe(true);
		expect(matchesFilters(done, filters({ status: 'done' }))).toBe(true);
	});

	it('an empty priority list means any priority', () => {
		expect(matchesFilters(task({ priority: 'low' }), filters())).toBe(true);
		expect(matchesFilters(task({ priority: 'low' }), filters({ priority: ['high'] }))).toBe(false);
		expect(
			matchesFilters(task({ priority: 'high' }), filters({ priority: ['high', 'urgent'] }))
		).toBe(true);
	});

	it('matches "me" against the viewer’s user id', () => {
		const me = filters({ assignee: { kind: 'me' } });
		expect(matchesFilters(mine, me, 'usr_me')).toBe(true);
		expect(matchesFilters(theirs, me, 'usr_me')).toBe(false);
		expect(matchesFilters(nobody, me, 'usr_me')).toBe(false);
	});

	it('matches "me" against the contact linked to the viewer', () => {
		// Same person, other id space — a task assigned to my contact record is
		// mine, or the portal and the staff list would disagree about my work.
		const me = filters({ assignee: { kind: 'me' } });
		expect(matchesFilters(myContact, me, { userId: 'usr_me', contactId: 'con_me' })).toBe(true);
		expect(matchesFilters(myContact, me, { userId: 'usr_me' })).toBe(false);
	});

	it('an unresolved viewer matches nothing, never everything', () => {
		const me = filters({ assignee: { kind: 'me' } });
		expect(matchesFilters(mine, me)).toBe(false);
		expect(matchesFilters(mine, me, '')).toBe(false);
		expect(isAssignedToViewer(undefined, 'usr_me')).toBe(false);
	});

	it('matches "unassigned" only when there is no assignee at all', () => {
		const none = filters({ assignee: { kind: 'unassigned' } });
		expect(matchesFilters(nobody, none)).toBe(true);
		expect(matchesFilters(mine, none)).toBe(false);
		expect(matchesFilters(myContact, none)).toBe(false);
	});

	it('matches a named user or contact without confusing the two id spaces', () => {
		expect(matchesFilters(mine, filters({ assignee: { kind: 'user', userId: 'usr_me' } }))).toBe(
			true
		);
		// Same string, other table: a contact filter must not match a user row.
		expect(
			matchesFilters(
				task({ assignee: { kind: 'contact', contactId: 'same' } }),
				filters({ assignee: { kind: 'user', userId: 'same' } })
			)
		).toBe(false);
	});

	it('filters by stage key and campaign', () => {
		const row = task({ stageKey: 'vetted', campaignId: 'cam_1' });
		expect(matchesFilters(row, filters({ stageKey: 'vetted' }))).toBe(true);
		expect(matchesFilters(row, filters({ stageKey: 'funded' }))).toBe(false);
		expect(matchesFilters(row, filters({ campaignId: 'cam_1' }))).toBe(true);
		expect(matchesFilters(row, filters({ campaignId: 'cam_2' }))).toBe(false);
		expect(matchesFilters(task(), filters({ stageKey: 'vetted' }))).toBe(false);
	});

	it('filters by record, and a campaign-level task is in no record’s list', () => {
		const row = task({ projectId: 'prj_1' });
		expect(matchesFilters(row, filters({ projectId: 'prj_1' }))).toBe(true);
		expect(matchesFilters(row, filters({ projectId: 'prj_2' }))).toBe(false);
		expect(matchesFilters(task(), filters({ projectId: 'prj_1' }))).toBe(false);
	});

	it('treats both date bounds as inclusive', () => {
		const row = task({ dueOn: '2026-03-04' });
		expect(matchesFilters(row, filters({ dueAfter: '2026-03-04' }))).toBe(true);
		expect(matchesFilters(row, filters({ dueBefore: '2026-03-04' }))).toBe(true);
		expect(matchesFilters(row, filters({ dueAfter: '2026-03-05' }))).toBe(false);
		expect(matchesFilters(row, filters({ dueBefore: '2026-03-03' }))).toBe(false);
	});

	it('excludes an undated task from any date range', () => {
		expect(matchesFilters(task(), filters({ dueBefore: '2026-12-31' }))).toBe(false);
		expect(matchesFilters(task(), filters({ dueAfter: '2020-01-01' }))).toBe(false);
	});

	it('applies every filter at once', () => {
		const row = task({
			priority: 'urgent',
			dueOn: '2026-03-04',
			stageKey: 'vetted',
			campaignId: 'cam_1',
			assignee: { kind: 'user', userId: 'usr_me' }
		});
		const all = filters({
			assignee: { kind: 'me' },
			priority: ['high', 'urgent'],
			status: 'todo',
			stageKey: 'vetted',
			campaignId: 'cam_1',
			dueAfter: '2026-01-01',
			dueBefore: '2026-12-31'
		});

		expect(matchesFilters(row, all, 'usr_me')).toBe(true);
		expect(matchesFilters({ ...row, priority: 'low' }, all, 'usr_me')).toBe(false);
	});
});
