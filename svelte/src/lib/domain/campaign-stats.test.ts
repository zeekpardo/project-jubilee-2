import { describe, expect, it } from 'vitest';

import {
	CHILD_AGE_MAX,
	defaultStatConfigs,
	isChildMember,
	memberStatLabel,
	isStatMetricKey,
	resolveStatConfigs,
	resolveStatLabel,
	SMALL_PUBLIC_COUNT_THRESHOLD,
	statConfigId,
	statConfigsError,
	statConfigsForSurface,
	STAT_METRIC_KEYS,
	STAT_METRICS,
	suppressesPublicValue,
	type StatConfig,
	type StatLabelContext,
	type StatSource
} from './campaign-stats';

const ctx: StatLabelContext = { objectLabelPlural: 'Families', goalLabel: 'Freed' };

function config(source: StatSource, overrides: Partial<StatConfig> = {}): StatConfig {
	return {
		id: statConfigId(source),
		order: 0,
		showOnPublic: true,
		showOnDashboard: false,
		source,
		...overrides
	};
}

describe('STAT_METRICS', () => {
	it('has exactly the four supported metrics', () => {
		expect(STAT_METRIC_KEYS.sort()).toEqual(
			['children_reached', 'people_reached', 'projects_freed', 'total_raised'].sort()
		);
	});

	it('every entry carries its own key and a count/money format', () => {
		for (const key of STAT_METRIC_KEYS) {
			const metric = STAT_METRICS[key];
			expect(metric.key).toBe(key);
			expect(['count', 'money']).toContain(metric.format);
		}
	});
});

describe('isStatMetricKey', () => {
	it('accepts known keys', () => {
		expect(isStatMetricKey('projects_freed')).toBe(true);
	});

	it('rejects unknown keys', () => {
		expect(isStatMetricKey('small_businesses_started')).toBe(false);
		expect(isStatMetricKey('')).toBe(false);
	});
});

describe('resolveStatLabel', () => {
	it('derives the goal metric label from the campaign vocabulary', () => {
		const label = resolveStatLabel(STAT_METRICS.projects_freed, ctx);
		expect(label).toBe('Families Freed');
	});

	it('follows a different campaign vocabulary for the same metric', () => {
		const label = resolveStatLabel(STAT_METRICS.projects_freed, {
			objectLabelPlural: 'Students',
			goalLabel: 'Enrolled'
		});
		expect(label).toBe('Students Enrolled');
	});

	it('uses the static default label for a non-goal metric', () => {
		expect(resolveStatLabel(STAT_METRICS.people_reached, ctx)).toBe('People Reached');
		expect(resolveStatLabel(STAT_METRICS.children_reached, ctx)).toBe('Children Reached');
	});

	it('an override wins over the default, trimmed', () => {
		const label = resolveStatLabel(STAT_METRICS.people_reached, ctx, '  Lives Touched  ');
		expect(label).toBe('Lives Touched');
	});

	it('an empty or whitespace-only override falls back to the default', () => {
		expect(resolveStatLabel(STAT_METRICS.people_reached, ctx, '')).toBe('People Reached');
		expect(resolveStatLabel(STAT_METRICS.people_reached, ctx, '   ')).toBe('People Reached');
		expect(resolveStatLabel(STAT_METRICS.people_reached, ctx, null)).toBe('People Reached');
	});
});

describe('statConfigId', () => {
	it('derives a stable id per source, so the same number cannot be listed twice', () => {
		expect(statConfigId({ kind: 'builtin', metric: 'projects_freed' })).toBe(
			'builtin:projects_freed'
		);
		expect(statConfigId({ kind: 'field', fieldKey: 'goats', aggregate: 'sum' })).toBe(
			'field:goats:sum'
		);
		expect(statConfigId({ kind: 'task', impactTag: 'business' })).toBe('task:business');
	});

	it('distinguishes countWhere buckets over the same field', () => {
		const medical = statConfigId({
			kind: 'field',
			fieldKey: 'reason',
			aggregate: 'countWhere',
			matchValue: 'Medical'
		});
		const debt = statConfigId({
			kind: 'field',
			fieldKey: 'reason',
			aggregate: 'countWhere',
			matchValue: 'Debt'
		});
		expect(medical).not.toBe(debt);
	});
});

describe('resolveStatConfigs', () => {
	it('falls back to the shipped three when a campaign has never configured any', () => {
		expect(resolveStatConfigs(undefined).map((row) => row.id)).toEqual([
			'builtin:projects_freed',
			'builtin:people_reached',
			'builtin:children_reached'
		]);
		expect(resolveStatConfigs(null)).toEqual(defaultStatConfigs());
	});

	it('treats an empty selection as "publish nothing", not as unset', () => {
		expect(resolveStatConfigs([])).toEqual([]);
	});

	it('sorts by order, tie-broken by id', () => {
		const rows = [
			config({ kind: 'task', impactTag: 'school' }, { order: 2 }),
			config({ kind: 'builtin', metric: 'people_reached' }, { order: 1 }),
			config({ kind: 'builtin', metric: 'children_reached' }, { order: 1 })
		];
		expect(resolveStatConfigs(rows).map((row) => row.id)).toEqual([
			'builtin:children_reached',
			'builtin:people_reached',
			'task:school'
		]);
	});
});

describe('statConfigsForSurface', () => {
	const rows = [
		config({ kind: 'builtin', metric: 'projects_freed' }, { showOnPublic: true }),
		config(
			{ kind: 'task', impactTag: 'legal_certificate' },
			{ order: 1, showOnPublic: false, showOnDashboard: true }
		)
	];

	it('publishes only what is flagged for the public site', () => {
		expect(statConfigsForSurface(rows, 'public').map((row) => row.id)).toEqual([
			'builtin:projects_freed'
		]);
	});

	it('a tagged-but-private stat is dashboard-only', () => {
		expect(statConfigsForSurface(rows, 'dashboard').map((row) => row.id)).toEqual([
			'task:legal_certificate'
		]);
	});
});

describe('suppressesPublicValue', () => {
	const tag: StatSource = { kind: 'task', impactTag: 'business' };
	const field: StatSource = { kind: 'field', fieldKey: 'goats', aggregate: 'count' };

	it('withholds a small task or field count', () => {
		expect(suppressesPublicValue(tag, 'count', SMALL_PUBLIC_COUNT_THRESHOLD - 1)).toBe(true);
		expect(suppressesPublicValue(field, 'count', 1)).toBe(true);
		expect(suppressesPublicValue(field, 'count', 0)).toBe(true);
	});

	it('publishes a count once it clears the floor', () => {
		expect(suppressesPublicValue(tag, 'count', SMALL_PUBLIC_COUNT_THRESHOLD)).toBe(false);
	});

	it('never withholds money, which is not a count of records', () => {
		expect(suppressesPublicValue(field, 'money', 100)).toBe(false);
	});

	it('never withholds a built-in, which counts already-published facts', () => {
		expect(suppressesPublicValue({ kind: 'builtin', metric: 'projects_freed' }, 'count', 1)).toBe(
			false
		);
	});
});

describe('isChildMember', () => {
	it('honours the explicit contact flag', () => {
		expect(isChildMember({ contactChild: true })).toBe(true);
	});

	it('reads the relationship recorded on the link', () => {
		expect(isChildMember({ relationship: 'child' })).toBe(true);
		expect(isChildMember({ relationship: '  Child ' })).toBe(true);
		expect(isChildMember({ relationship: 'head' })).toBe(false);
		expect(isChildMember({ relationship: 'spouse' })).toBe(false);
	});

	it('reads the household role, which is what this app populates', () => {
		expect(isChildMember({ householdRoles: ['child'] })).toBe(true);
		expect(isChildMember({ householdRoles: ['parent_guardian'] })).toBe(false);
		expect(isChildMember({ householdRoles: ['adult', 'child'] })).toBe(true);
	});

	it('falls back to a recorded age only when no relationship contradicts it', () => {
		expect(isChildMember({ age: 9 })).toBe(true);
		expect(isChildMember({ age: CHILD_AGE_MAX })).toBe(true);
		expect(isChildMember({ age: CHILD_AGE_MAX + 1 })).toBe(false);
		expect(isChildMember({ relationship: 'other', age: 9 })).toBe(true);
		// A stated relationship beats an age that may be years stale.
		expect(isChildMember({ relationship: 'head', age: 9 })).toBe(false);
	});

	it('accepts an age that arrived as a string, and ignores nonsense', () => {
		expect(isChildMember({ age: '12' })).toBe(true);
		expect(isChildMember({ age: 'twelve' })).toBe(false);
		expect(isChildMember({ age: -1 })).toBe(false);
	});

	it('is false when nothing says anything', () => {
		expect(isChildMember({})).toBe(false);
		expect(isChildMember({ contactChild: null, relationship: null, householdRoles: [] })).toBe(
			false
		);
	});
});

describe('member stats', () => {
	const children: StatSource = {
		kind: 'member',
		among: { kind: 'task', impactTag: 'school' },
		filter: { dimension: 'householdRole', value: 'child' },
		count: 'people'
	};

	it('gives each declaration its own id', () => {
		expect(statConfigId(children)).toBe('member:task=school:householdRole=child:people');
	});

	it('separates people from records over the same declaration', () => {
		expect(statConfigId({ ...children, count: 'records' } as StatSource)).not.toBe(
			statConfigId(children)
		);
	});

	it('separates an unfiltered count from a filtered one', () => {
		const anyone: StatSource = {
			kind: 'member',
			among: { kind: 'goalMet' },
			count: 'people'
		};
		expect(statConfigId(anyone)).toBe('member:goalMet:anyone:people');
	});

	it('names itself after the people and the records it counts', () => {
		expect(memberStatLabel(children as never, ctx)).toBe('Child — School');
		expect(memberStatLabel({ ...children, among: { kind: 'goalMet' } } as never, ctx)).toBe(
			'Child in Families Freed'
		);
		expect(memberStatLabel({ ...children, count: 'records' } as never, ctx)).toBe(
			'Families with a Child'
		);
	});

	it('borrows a contact field its admin-authored label', () => {
		const source: StatSource = {
			kind: 'member',
			among: { kind: 'all' },
			filter: { dimension: 'contactField', fieldKey: 'grade_level', matchValue: '5' },
			count: 'people'
		};
		expect(memberStatLabel(source as never, ctx, () => 'Grade')).toBe('Grade: 5');
	});

	it('is subject to the small-count floor — a count of people is the sharpest one', () => {
		expect(suppressesPublicValue(children, 'count', 2)).toBe(true);
		expect(suppressesPublicValue(children, 'count', SMALL_PUBLIC_COUNT_THRESHOLD)).toBe(false);
	});

	it('refuses a protected contact key at write time', () => {
		const source: StatSource = {
			kind: 'member',
			among: { kind: 'all' },
			filter: { dimension: 'contactField', fieldKey: 'home_address' },
			count: 'people'
		};
		expect(statConfigsError([config(source)])).toMatch(/protected/);
	});

	it('requires a tag when counting against completed work', () => {
		const source: StatSource = {
			kind: 'member',
			among: { kind: 'task', impactTag: '  ' },
			count: 'people'
		};
		expect(statConfigsError([config(source)])).toMatch(/impact tag/);
	});

	it('accepts a well-formed declaration', () => {
		expect(statConfigsError([config(children)])).toBeNull();
	});
});

describe('statConfigsError', () => {
	it('accepts a well-formed selection', () => {
		expect(
			statConfigsError([
				config({ kind: 'builtin', metric: 'projects_freed' }),
				config({ kind: 'field', fieldKey: 'goats', aggregate: 'sum' }, { order: 1 }),
				config({ kind: 'task', impactTag: 'business' }, { order: 2 })
			])
		).toBeNull();
	});

	it('rejects an unknown built-in metric', () => {
		expect(statConfigsError([config({ kind: 'builtin', metric: 'nonsense' })])).toMatch(/nonsense/);
	});

	it('refuses a protected field key at write time', () => {
		expect(
			statConfigsError([config({ kind: 'field', fieldKey: 'site_ref', aggregate: 'count' })])
		).toMatch(/protected/);
		expect(
			statConfigsError([config({ kind: 'field', fieldKey: 'factory_ref', aggregate: 'count' })])
		).toMatch(/protected/);
	});

	it('requires a match value for countWhere', () => {
		expect(
			statConfigsError([config({ kind: 'field', fieldKey: 'reason', aggregate: 'countWhere' })])
		).toMatch(/match/);
	});

	it('requires an impact tag for a task stat', () => {
		expect(statConfigsError([config({ kind: 'task', impactTag: '  ' })])).toMatch(/impact tag/);
	});

	it('rejects the same stat listed twice', () => {
		const row = config({ kind: 'builtin', metric: 'projects_freed' });
		expect(statConfigsError([row, { ...row, order: 1 }])).toMatch(/Duplicate/);
	});
});
