// ============================================================
// Campaign stats — the admin-controlled impact numbers
// ============================================================
// Pure registry of the built-in stat metrics, plus the shape of a campaign's
// stat SELECTION and the rules that decide what a selection may publish. The
// values themselves are computed server-side, in the privacy wall
// (convex/model/stats.ts), which has the db access this module deliberately
// does not: it stays pure so both server and client can import it, and so it
// is trivially testable like every other lib/domain module.
//
// A stat is a small declaration with one of three sources:
//
//   builtin — a number only code can compute (goal met, people reached,
//             total raised). The admin controls it by choosing to show it.
//   field   — an aggregate over a custom field the admin defined. The fastest
//             path to admin control: it reuses the custom-fields engine.
//   task    — a count over completed checklist items carrying an impact tag.
//             The most truthful source: the number moves because work got
//             done, not because someone edited a number.
//
// Registry keys are intentionally generic ('projects_freed', not
// 'families_freed') to match this app's project/campaign vocabulary.
// ============================================================

import { isProtectedFieldKey } from './field-definitions';

export type StatMetricKey =
	| 'projects_freed'
	| 'people_reached'
	| 'children_reached'
	| 'total_raised';

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

/**
 * Anyone this age or younger is a child when no relationship says otherwise.
 * Ported from the reference's impact query rather than picked: changing it
 * would silently restate every published children figure.
 */
export const CHILD_AGE_MAX = 17;

/** Everything that can tell us a person attached to a record is a child. */
export interface ChildMemberInput {
	/** `contacts.child` — an explicit flag, when an org populates it. */
	contactChild?: boolean | null;
	/** `projectMembers.attributes.relationship` — "child", "head", "spouse". */
	relationship?: string | null;
	/** Every `householdMembers.role` this person holds. */
	householdRoles?: string[];
	/** `projectMembers.attributes.age` — a number RECORDED at intake. */
	age?: unknown;
}

/**
 * Is this person a child?
 *
 * Four signals, because no one of them is populated everywhere. The original
 * built-in read `contacts.child` alone, which nothing in this app has ever
 * written — so it counted zero children in a database full of them. The
 * relationship and household-role signals are what the data actually carries.
 *
 * Age is only consulted when the relationship is absent or "other", matching
 * the reference: a recorded relationship is a statement about this person and
 * beats an age that may be stale. It reads a RECORDED age rather than deriving
 * one from `contacts.birthdate`, deliberately — a birthdate needs today's date
 * to become an age, and a Convex query must not read the clock (it would go
 * stale without a write and would poison the query cache).
 */
export function isChildMember(input: ChildMemberInput): boolean {
	if (input.contactChild === true) return true;

	const relationship = input.relationship?.trim().toLowerCase() ?? '';
	if (relationship === 'child') return true;

	if (input.householdRoles?.some((role) => role.trim().toLowerCase() === 'child')) return true;

	// Only where no relationship contradicts it.
	if (relationship !== '' && relationship !== 'other') return false;
	const age = typeof input.age === 'number' ? input.age : Number(input.age);
	return Number.isFinite(age) && age >= 0 && age <= CHILD_AGE_MAX;
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
	},
	total_raised: {
		key: 'total_raised',
		defaultLabel: 'Total Raised',
		format: 'money'
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

// ------------------------------------------------------------------
// The selection — what a campaign has chosen to publish
// ------------------------------------------------------------------

/** How a `field` stat turns a column of values into one number. */
export type StatAggregate = 'sum' | 'count' | 'countWhere';

export const STAT_AGGREGATES: StatAggregate[] = ['sum', 'count', 'countWhere'];

// ------------------------------------------------------------------
// Member stats — counting PEOPLE rather than records
// ------------------------------------------------------------------
// A `task` stat answers "how many families got a business started". It cannot
// answer "how many children were enrolled in school", because that is a count
// of people, and one record holds several.
//
// A member stat is three choices: WHICH RECORDS to look at, WHICH PEOPLE on
// them to count, and whether the answer is a number of people or a number of
// records that have at least one.

/** Which records' people a member stat looks at. */
export type MemberAmong =
	| { kind: 'all' }
	| { kind: 'goalMet' }
	| { kind: 'task'; impactTag: string };

/**
 * Which people to count. Three dimensions, chosen because they are the ones
 * this app's data actually populates:
 *
 *   householdRole — `householdMembers.role`, the child/parent_guardian/adult
 *                   enum, reached through the person's household.
 *   relationship  — `projectMembers.attributes.relationship`, the word recorded
 *                   on the link between this record and this person. Free text,
 *                   so a campaign uses its own vocabulary.
 *   contactField  — any custom field defined on the contact entity. The
 *                   open-ended one, and the only one that generalises past a
 *                   single campaign's vocabulary.
 *
 * NOT offered: `projectMembers.role`. It reads like the obvious choice and is
 * the wrong one — every family member carries the constant 'member' there,
 * with the real relationship in the attributes bag.
 */
export type MemberFilter =
	| { dimension: 'householdRole'; value: string }
	| { dimension: 'relationship'; value: string }
	| {
			dimension: 'contactField';
			fieldKey: string;
			/** Unset means "has any value", the same reading a `count` field stat takes. */
			matchValue?: string;
	  };

export const MEMBER_DIMENSIONS: MemberFilter['dimension'][] = [
	'householdRole',
	'relationship',
	'contactField'
];

/** The household roles the schema defines, in the order a form should list them. */
export const HOUSEHOLD_ROLES = ['child', 'parent_guardian', 'adult', 'other_adult'];

/**
 * People, or records holding at least one matching person. "12 children
 * enrolled" and "9 families with a child enrolled" are both useful and are the
 * same declaration with this switched.
 */
export type MemberCount = 'people' | 'records';

/** Where a stat's number comes from. Mirrors `campaigns.publicStats[].source`. */
export type StatSource =
	| { kind: 'builtin'; metric: string }
	| {
			kind: 'field';
			fieldKey: string;
			aggregate: StatAggregate;
			/** Only meaningful for `countWhere`. */
			matchValue?: string;
	  }
	| { kind: 'task'; impactTag: string }
	| {
			kind: 'member';
			among: MemberAmong;
			/** Unset counts every person on the records, donors excluded. */
			filter?: MemberFilter;
			count: MemberCount;
	  };

export type StatSourceKind = StatSource['kind'];

/** One row of a campaign's stat selection. Mirrors `campaigns.publicStats[]`. */
export interface StatConfig {
	/** Stable key for ordering and editing. See `statConfigId`. */
	id: string;
	/** Override; unset means the source's own default wording. */
	label?: string;
	order: number;
	showOnPublic: boolean;
	showOnDashboard: boolean;
	source: StatSource;
}

/** Which surface a resolved stat list is being built for. */
export type StatSurface = 'public' | 'dashboard';

/**
 * A stat's id is DERIVED from its source rather than random, so a campaign
 * cannot end up with the same number listed twice under two ids, and so a row
 * stays recognisable in the stored document.
 */
export function statConfigId(source: StatSource): string {
	switch (source.kind) {
		case 'builtin':
			return `builtin:${source.metric}`;
		case 'field':
			return source.aggregate === 'countWhere'
				? `field:${source.fieldKey}:countWhere:${source.matchValue ?? ''}`
				: `field:${source.fieldKey}:${source.aggregate}`;
		case 'task':
			return `task:${source.impactTag}`;
		case 'member':
			return `member:${memberAmongId(source.among)}:${memberFilterId(source.filter)}:${source.count}`;
	}
}

function memberAmongId(among: MemberAmong): string {
	return among.kind === 'task' ? `task=${among.impactTag}` : among.kind;
}

function memberFilterId(filter: MemberFilter | undefined): string {
	if (!filter) return 'anyone';
	switch (filter.dimension) {
		case 'householdRole':
			return `householdRole=${filter.value}`;
		case 'relationship':
			return `relationship=${filter.value}`;
		case 'contactField':
			return `contactField=${filter.fieldKey}${filter.matchValue ? `=${filter.matchValue}` : ''}`;
	}
}

/**
 * What a campaign publishes when it has never configured anything: the three
 * counts this app shipped with, public only. Keeping the fallback here (rather
 * than backfilling every campaign row) is what lets the selection ship without
 * a migration — an unset `publicStats` keeps behaving exactly as before.
 */
export function defaultStatConfigs(): StatConfig[] {
	return (['projects_freed', 'people_reached', 'children_reached'] as const).map(
		(metric, index) => ({
			id: statConfigId({ kind: 'builtin', metric }),
			order: index,
			showOnPublic: true,
			showOnDashboard: false,
			source: { kind: 'builtin', metric } as StatSource
		})
	);
}

/**
 * The campaign's selection in render order, falling back to the defaults when
 * it has none. An EMPTY array is a real choice — "publish no stats" — and is
 * kept as such; only an absent selection falls back.
 */
export function resolveStatConfigs(configs: StatConfig[] | null | undefined): StatConfig[] {
	const rows = configs ?? defaultStatConfigs();
	return [...rows].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** The selection filtered to one surface, still in render order. */
export function statConfigsForSurface(
	configs: StatConfig[] | null | undefined,
	surface: StatSurface
): StatConfig[] {
	return resolveStatConfigs(configs).filter((config) =>
		surface === 'public' ? config.showOnPublic : config.showOnDashboard
	);
}

// ------------------------------------------------------------------
// Small counts leak
// ------------------------------------------------------------------
// "1 record is tagged `business`" next to a grid of two published records is
// close to identifying: an aggregate over private data can reveal it without
// a single record being published. So a public count below this floor is
// dropped rather than rendered.

export const SMALL_PUBLIC_COUNT_THRESHOLD = 5;

/**
 * Whether a computed value must be withheld from a PUBLIC surface. Internal
 * and dashboard numbers are never suppressed — the whole point of the
 * dashboard strip is that staff see the real figure.
 *
 * `builtin` metrics are exempt, deliberately. They aggregate facts this app
 * already publishes per record — the goal-met badge and the member count sit
 * on every public project card — so suppressing them hides nothing an
 * attacker could not read off the grid, while blanking the impact strip of
 * every campaign that has freed fewer than five families. The rule exists for
 * aggregates over data that is NOT otherwise published, which is exactly what
 * `field`, `task` and `member` sources are.
 *
 * `member` counts are the sharpest of the three: "2 children enrolled" over a
 * grid of a few published families is close to naming them.
 *
 * Money is exempt for the same reason: a dollar total is not a count of
 * records, and each project's own raised/target figures are already public.
 */
export function suppressesPublicValue(
	source: StatSource,
	format: StatFormat,
	value: number
): boolean {
	if (source.kind === 'builtin') return false;
	if (format !== 'count') return false;
	return value < SMALL_PUBLIC_COUNT_THRESHOLD;
}

// ------------------------------------------------------------------
// Validation — enforced at write time, re-checked at read time
// ------------------------------------------------------------------

/**
 * Why a stat config may not be saved, or null when it is fine. The public
 * wall re-derives its own exposure decisions at read time (a config naming a
 * private or protected source is SKIPPED, not rendered); this is the earlier,
 * friendlier gate so an admin never saves something that will silently vanish.
 */
export function statConfigError(config: StatConfig): string | null {
	if (!config.id.trim()) return 'A stat needs an id';

	switch (config.source.kind) {
		case 'builtin':
			return isStatMetricKey(config.source.metric)
				? null
				: `Unknown built-in metric "${config.source.metric}"`;
		case 'field': {
			const key = config.source.fieldKey.trim();
			if (!key) return 'A field stat needs a field';
			// Refused at WRITE time as well as dropped at read time — the same
			// two-sided enforcement publicAttributeList already gets.
			if (isProtectedFieldKey(key)) {
				return `"${key}" is a protected field key and can never be published`;
			}
			if (!STAT_AGGREGATES.includes(config.source.aggregate)) {
				return `Unknown aggregate "${config.source.aggregate}"`;
			}
			if (config.source.aggregate === 'countWhere' && !config.source.matchValue?.trim()) {
				return 'A "count where" stat needs a value to match';
			}
			return null;
		}
		case 'task':
			return config.source.impactTag.trim() ? null : 'A task stat needs an impact tag';
		case 'member': {
			const { among, filter, count } = config.source;
			if (among.kind === 'task' && !among.impactTag.trim()) {
				return 'A people stat counting completed work needs an impact tag';
			}
			if (count !== 'people' && count !== 'records') {
				return `Unknown count "${count}"`;
			}
			if (!filter) return null;
			if (filter.dimension === 'contactField') {
				const key = filter.fieldKey.trim();
				if (!key) return 'A contact-field filter needs a field';
				// Same refusal as a field stat: a protected key can never be
				// published, so it must not even be storable.
				if (isProtectedFieldKey(key)) {
					return `"${key}" is a protected field key and can never be published`;
				}
				return null;
			}
			return filter.value.trim() ? null : 'That filter needs a value';
		}
	}
}

/** "parent_guardian" -> "Parent Guardian". Shared by labels and pickers. */
export function humanizeToken(token: string): string {
	return token
		.split(/[_\s-]+/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

/** What a member filter describes, in words. `null` filter = everyone. */
export function memberFilterLabel(
	filter: MemberFilter | undefined,
	fieldLabel?: (key: string) => string
): string {
	if (!filter) return 'People';
	switch (filter.dimension) {
		case 'householdRole':
		case 'relationship':
			return humanizeToken(filter.value);
		case 'contactField': {
			const label = fieldLabel?.(filter.fieldKey) ?? humanizeToken(filter.fieldKey);
			return filter.matchValue ? `${label}: ${filter.matchValue}` : label;
		}
	}
}

/**
 * The default wording for a member stat, e.g. "Children in Families Freed" or
 * "Families with a Child". An admin can always override it; this only has to be
 * unambiguous enough that a freshly added stat is recognisable in the list.
 */
export function memberStatLabel(
	source: Extract<StatSource, { kind: 'member' }>,
	ctx: StatLabelContext,
	fieldLabel?: (key: string) => string
): string {
	const who = memberFilterLabel(source.filter, fieldLabel);

	if (source.count === 'records') {
		// "Families with a Child" — the record is the subject, so it leads.
		return source.filter
			? `${ctx.objectLabelPlural} with a ${who}`
			: `${ctx.objectLabelPlural} with People`;
	}

	switch (source.among.kind) {
		case 'all':
			return who;
		case 'goalMet':
			return `${who} in ${ctx.objectLabelPlural} ${ctx.goalLabel}`;
		case 'task':
			return `${who} — ${humanizeToken(source.among.impactTag)}`;
	}
}

/** The first error across a whole selection, plus the duplicate-id check. */
export function statConfigsError(configs: StatConfig[]): string | null {
	const seen = new Set<string>();
	for (const config of configs) {
		const error = statConfigError(config);
		if (error) return error;
		if (seen.has(config.id)) return `Duplicate stat "${config.id}"`;
		seen.add(config.id);
	}
	return null;
}
