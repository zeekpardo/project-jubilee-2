import { describe, expect, it } from 'vitest';

import {
	isStatMetricKey,
	resolveStatLabel,
	STAT_METRIC_KEYS,
	STAT_METRICS,
	type StatLabelContext
} from './campaign-stats';

const ctx: StatLabelContext = { objectLabelPlural: 'Families', goalLabel: 'Freed' };

describe('STAT_METRICS', () => {
	it('has exactly the three supported metrics', () => {
		expect(STAT_METRIC_KEYS.sort()).toEqual(
			['children_reached', 'people_reached', 'projects_freed'].sort()
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
		expect(isStatMetricKey('total_raised')).toBe(false);
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
