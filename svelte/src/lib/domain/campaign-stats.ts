// ============================================================
// Campaign stats — the public-site impact numbers (Phase 5)
// ============================================================
// Pure registry of the built-in stat metrics + label resolution. The values
// themselves are computed server-side, in the privacy wall
// (convex/model/public.ts), which has the db access this module deliberately
// does not: it stays pure so both server and client can import it, and so it
// is trivially testable like every other lib/domain module.
//
// Only three metrics exist today. The reference app also has
// small_businesses_started/schools_started, but those are derived from
// completed template tasks tagged with an impact tag — this app has no
// `tasks` table yet, so those two are left out rather than faked.
//
// Registry keys are intentionally generic ('projects_freed', not
// 'families_freed') to match this app's project/campaign vocabulary, and the
// shape stays open (a metric can carry more than key/defaultLabel/format
// later, and a per-campaign selection/override table can be layered on top)
// without reshaping what already exists.
// ============================================================

export type StatMetricKey = 'projects_freed' | 'people_reached' | 'children_reached';

export type StatFormat = 'count' | 'money';

// A donor attached to a record is not a person that record reached. Counting
// them would inflate the public impact number with the very people being
// asked to give, and inflate a project's household size with strangers.
// projectMembers.role is free text so a campaign can use its own vocabulary,
// which makes this a denylist: an unrecognized role describes someone the
// project serves or involves, and only a donor role is excluded.
const DONOR_ROLES = new Set(['sponsor', 'donor']);

/** Whether a projectMembers row counts as a person the project reached. */
export function isPersonReachedRole(role: string): boolean {
	return !DONOR_ROLES.has(role.trim().toLowerCase());
}

/** What a metric needs to resolve a label when it borrows the campaign's own wording. */
export interface StatLabelContext {
	objectLabelPlural: string;
	goalLabel: string;
}

export interface StatMetric {
	key: StatMetricKey;
	/**
	 * Either a fixed label, or a function of the campaign's own vocabulary —
	 * the goal metric reads as "<objectLabelPlural> <goalLabel>" (e.g.
	 * "Families Freed"), which only the campaign knows how to word.
	 */
	defaultLabel: string | ((ctx: StatLabelContext) => string);
	format: StatFormat;
}

export const STAT_METRICS: Record<StatMetricKey, StatMetric> = {
	projects_freed: {
		key: 'projects_freed',
		defaultLabel: (ctx) => `${ctx.objectLabelPlural} ${ctx.goalLabel}`,
		format: 'count'
	},
	people_reached: {
		key: 'people_reached',
		defaultLabel: 'People Reached',
		format: 'count'
	},
	children_reached: {
		key: 'children_reached',
		defaultLabel: 'Children Reached',
		format: 'count'
	}
};

export const STAT_METRIC_KEYS = Object.keys(STAT_METRICS) as StatMetricKey[];

export function isStatMetricKey(key: string): key is StatMetricKey {
	return key in STAT_METRICS;
}

/**
 * The label to show for a metric: an explicit override wins (kept as a
 * parameter now so a future per-campaign override table can plug in without
 * reshaping this function); otherwise the metric's default, resolved against
 * the campaign's own vocabulary when the default is a function of it.
 */
export function resolveStatLabel(
	metric: StatMetric,
	ctx: StatLabelContext,
	override?: string | null
): string {
	const trimmed = override?.trim();
	if (trimmed) return trimmed;
	return typeof metric.defaultLabel === 'function' ? metric.defaultLabel(ctx) : metric.defaultLabel;
}
