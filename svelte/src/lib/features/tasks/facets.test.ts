import { describe, expect, it } from 'vitest';

import {
	assigneeFilterOptions,
	withSelected,
	type AssigneeFacets,
	type AssigneeLabels,
	type KnownMembers
} from './facets';

const LABELS: AssigneeLabels = {
	anyone: 'Anyone',
	me: 'Assigned to me',
	unassigned: 'Unassigned',
	unknown: 'Someone no longer listed'
};

const MEMBERS: KnownMembers = {
	users: [
		{ userId: 'u1', name: 'Ada' },
		{ userId: 'u2', name: 'Bea' }
	],
	contacts: [
		{ contactId: 'c1', name: 'Cleo', authUserId: null },
		{ contactId: 'c2', name: 'Ada Lovelace', authUserId: 'u1' }
	]
};

function facets(overrides: Partial<AssigneeFacets> = {}): AssigneeFacets {
	return { users: [], contacts: [], unassigned: false, mine: false, ...overrides };
}

const values = (options: { value: string }[]): string[] => options.map((option) => option.value);
const keys = (items: readonly { key: string }[]): string[] => items.map((item) => item.key);

describe('withSelected', () => {
	const all = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
	const key = (item: { key: string }): string => item.key;

	it('narrows to what occurs', () => {
		expect(withSelected([{ key: 'b' }], all, key, undefined)).toEqual([{ key: 'b' }]);
	});

	it('offers everything while the facets are still loading', () => {
		expect(withSelected(undefined, all, key, undefined)).toEqual(all);
	});

	it('keeps a selected value that has no rows behind it', () => {
		expect(keys(withSelected([{ key: 'b' }], all, key, 'c'))).toEqual(['b', 'c']);
	});

	it('does not duplicate a selected value that does occur', () => {
		expect(keys(withSelected([{ key: 'b' }], all, key, 'b'))).toEqual(['b']);
	});

	it('leaves an unknown selection out rather than inventing a row for it', () => {
		expect(withSelected([{ key: 'b' }], all, key, 'zz')).toEqual([{ key: 'b' }]);
	});
});

describe('assigneeFilterOptions', () => {
	it('offers everyone before the facets answer', () => {
		expect(values(assigneeFilterOptions(undefined, MEMBERS, '', LABELS))).toEqual([
			'',
			'me',
			'unassigned',
			'user:u1',
			'user:u2',
			// c2 is Ada's linked contact — the same person as u1, so not a second row.
			'contact:c1'
		]);
	});

	it('offers only the people who have tasks once they do', () => {
		const only = facets({ users: [{ userId: 'u2', name: 'Bea' }] });
		expect(values(assigneeFilterOptions(only, MEMBERS, '', LABELS))).toEqual(['', 'user:u2']);
	});

	it('withholds "assigned to me" and "unassigned" when neither has rows', () => {
		expect(values(assigneeFilterOptions(facets(), MEMBERS, '', LABELS))).toEqual(['']);
	});

	it('offers them when they do', () => {
		const both = facets({ mine: true, unassigned: true });
		expect(values(assigneeFilterOptions(both, MEMBERS, '', LABELS))).toEqual([
			'',
			'me',
			'unassigned'
		]);
	});

	it('keeps "assigned to me" when it is the selection, so it can be cleared', () => {
		expect(values(assigneeFilterOptions(facets(), MEMBERS, 'me', LABELS))).toEqual(['', 'me']);
	});

	it('keeps a selected person with no rows, and still names them', () => {
		const options = assigneeFilterOptions(facets(), MEMBERS, 'user:u1', LABELS);
		expect(values(options)).toEqual(['', 'user:u1']);
		expect(options[1].label).toBe('Ada');
	});

	it('keeps a selected id nobody can name, under a word rather than the id', () => {
		const options = assigneeFilterOptions(facets(), MEMBERS, 'user:gone', LABELS);
		expect(values(options)).toEqual(['', 'user:gone']);
		expect(options[1].label).toBe(LABELS.unknown);
	});

	it('does not repeat a selected person who does have rows', () => {
		const only = facets({ users: [{ userId: 'u2', name: 'Bea' }] });
		expect(values(assigneeFilterOptions(only, MEMBERS, 'user:u2', LABELS))).toEqual([
			'',
			'user:u2'
		]);
	});

	it('names people from the facets, not from the capped member list', () => {
		// A contact past `ASSIGNABLE_CONTACT_MAX` is absent from `members` and must
		// still be offered — the facet carries its own name for exactly this.
		const only = facets({ contacts: [{ contactId: 'c999', name: 'Zed' }] });
		const options = assigneeFilterOptions(only, MEMBERS, '', LABELS);
		expect(values(options)).toEqual(['', 'contact:c999']);
		expect(options[1].label).toBe('Zed');
	});
});
