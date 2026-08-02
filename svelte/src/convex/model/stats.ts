// ============================================================
// The stat engine — turning a campaign's selection into numbers
// ============================================================
// One engine, two surfaces. The public site and the campaign dashboard render
// the SAME configured stat list; they differ only in which rows they ask for
// (`showOnPublic` vs `showOnDashboard`) and in what this module is willing to
// tell them.
//
// PUBLIC READS ARE FAIL-CLOSED. A config row naming a source that is not
// publishable is SKIPPED, never rendered — the same posture publicAttributeList
// takes. Four rules, all enforced here rather than only in the admin UI, because
// a config row can outlive the state it was saved under (a field can be
// un-published, a field can be deleted, a key can be added to the protected
// denylist):
//
//   1. A public `field` stat requires the field definition's own isPublic.
//   2. A protected field key is refused at write time AND dropped here, so no
//      past or future write path can leak one.
//   3. A public COUNT below SMALL_PUBLIC_COUNT_THRESHOLD is withheld: "1 record
//      is tagged business" alongside a grid of two published records is close
//      to identifying. See suppressesPublicValue for which sources are exempt
//      and why.
//   4. `countWhere` publishes a DISTRIBUTION ("3 = Medical, 1 = Debt"), so it
//      is publishable only when every non-empty bucket of that field clears the
//      threshold — suppressing just the small bucket still leaves the shape of
//      the distribution visible.
//
// A public read is also always LIFETIME. The date window below is
// dashboard-only, which is what keeps "does 'this year' mean the calendar or
// the financial year?" off a donor-facing surface entirely.
// ============================================================

import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import {
	humanizeToken,
	isChildMember,
	isPersonReachedRole,
	isStatMetricKey,
	memberStatLabel,
	resolveStatConfigs,
	resolveStatLabel,
	STAT_METRICS,
	suppressesPublicValue,
	type MemberFilter,
	type StatConfig,
	type StatFormat,
	type StatSource,
	type StatSurface
} from '../../lib/domain/campaign-stats';
import { isProtectedFieldKey, type FieldDefinition } from '../../lib/domain/field-definitions';
import type { PublicPolicy } from '../../lib/domain/public-policy';
import { resolveContactFieldDefs, resolveProjectFieldDefs } from './fields';
import { loadPublicPolicy } from './policy';

/** One computed stat, ready to render. */
export type ResolvedStat = {
	/** The config's stable id. Named `key` because that is what the tile grid keys on. */
	key: string;
	label: string;
	value: number;
	format: StatFormat;
	/**
	 * True when the number ignores the requested date window because its source
	 * carries no timestamp (every `field` stat). The dashboard says so rather
	 * than showing a lifetime figure in a row of filtered ones.
	 */
	lifetime: boolean;
};

/**
 * A dashboard-only date window, in epoch ms. Public callers pass nothing.
 * Bounds are inclusive; an event with no timestamp at all is excluded whenever
 * a window is set, because it cannot be placed in time.
 */
export type StatWindow = { from?: number; to?: number };

export type ComputeStatsOptions = {
	surface: StatSurface;
	window?: StatWindow;
};

function withinWindow(at: number | undefined, window: StatWindow | undefined): boolean {
	if (!window || (window.from === undefined && window.to === undefined)) return true;
	if (at === undefined) return false;
	if (window.from !== undefined && at < window.from) return false;
	if (window.to !== undefined && at > window.to) return false;
	return true;
}

/** Whether a stored attribute value counts as "set" for a `count` aggregate. */
function isSetValue(value: unknown): boolean {
	if (value === null || value === undefined || value === '') return false;
	// A boolean field's "no" is a recorded answer, not a tick — counting it
	// would make a yes/no column count every project that was ever asked.
	if (typeof value === 'boolean') return value;
	return true;
}

/** Everything the sources read, loaded once per call rather than per stat. */
type StatScope = {
	campaign: Doc<'campaigns'>;
	/** Projects whose stage counts toward impact. */
	projects: Doc<'projects'>[];
	projectIds: Set<string>;
	defs: Map<string, FieldDefinition>;
	/** Contact-entity definitions, for a member stat filtering on one. */
	contactDefs: Map<string, FieldDefinition>;
	/** This org's count floor and its own protected keys. */
	policy: PublicPolicy;
};

async function loadScope(ctx: QueryCtx, campaign: Doc<'campaigns'>): Promise<StatScope> {
	const stages = await ctx.db
		.query('pipelineStages')
		.withIndex('by_campaignId_and_order', (q) => q.eq('campaignId', campaign._id))
		.collect();
	// Absent means true — a stage counts unless an admin has said it should not,
	// so campaigns that predate the flag keep the numbers they had. This is the
	// line between "left the programme successfully" (still impact) and "should
	// never have been here" (never was).
	const excludedStages = new Set(
		stages.filter((stage) => stage.countsTowardImpact === false).map((stage) => stage.key)
	);

	const allProjects = await ctx.db
		.query('projects')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
		.collect();
	const projects = allProjects.filter((project) => !excludedStages.has(project.stage));

	const defs = await resolveProjectFieldDefs(ctx, campaign.orgId, campaign._id);
	const contactDefs = await resolveContactFieldDefs(ctx, campaign.orgId, campaign._id);
	const policy = await loadPublicPolicy(ctx, campaign.orgId);

	return {
		campaign,
		projects,
		projectIds: new Set(projects.map((project) => project._id as string)),
		defs: new Map(defs.map((def) => [def.key, def])),
		contactDefs: new Map(contactDefs.map((def) => [def.key, def])),
		policy
	};
}

// ------------------------------------------------------------------
// Member source — counting people
// ------------------------------------------------------------------

/** One person on one record, with every dimension a filter can ask about. */
type MemberRow = {
	projectId: string;
	contactId: string;
	/** projectMembers.attributes.relationship — the word recorded on the link. */
	relationship: string | null;
	/** projectMembers.attributes.age — a number recorded at intake, if any. */
	age: unknown;
	/** Every household role this person holds. A person can be in more than one. */
	householdRoles: string[];
	/** contacts.child, for an org that populates the explicit flag. */
	contactChild: boolean | null;
	contactFields: Record<string, unknown>;
};

/**
 * Every non-donor person attached to the in-scope records, resolved once.
 *
 * This is the expensive read in the module — a contact and its household links
 * per member — so it is built lazily and only when a member stat is actually
 * configured.
 */
async function loadMembers(ctx: QueryCtx, scope: StatScope): Promise<MemberRow[]> {
	const out: MemberRow[] = [];
	// A contact can be attached to several records; resolving them once keeps a
	// large campaign from re-reading the same person per record.
	const contactCache = new Map<string, { contact: Doc<'contacts'> | null; roles: string[] }>();

	for (const project of scope.projects) {
		const links = await ctx.db
			.query('projectMembers')
			.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
			.collect();

		for (const link of links) {
			// A donor attached to a record is not a person that record reached.
			if (!isPersonReachedRole(link.role)) continue;

			const contactId = link.contactId as string;
			let resolved = contactCache.get(contactId);
			if (!resolved) {
				const contact = await ctx.db.get('contacts', link.contactId);
				const householdLinks = await ctx.db
					.query('householdMembers')
					.withIndex('by_contactId', (q) => q.eq('contactId', link.contactId))
					.collect();
				resolved = { contact, roles: householdLinks.map((row) => row.role) };
				contactCache.set(contactId, resolved);
			}

			const relationship = link.attributes?.relationship;
			out.push({
				projectId: project._id as string,
				contactId,
				relationship: typeof relationship === 'string' ? relationship : null,
				age: link.attributes?.age,
				householdRoles: resolved.roles,
				contactChild: resolved.contact?.child ?? null,
				contactFields: resolved.contact?.customFields ?? {}
			});
		}
	}

	return out;
}

/** Case-insensitive, because these are hand-entered vocabularies. */
function sameToken(a: string | null | undefined, b: string): boolean {
	return (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
}

function matchesFilter(member: MemberRow, filter: MemberFilter | undefined): boolean {
	if (!filter) return true;
	switch (filter.dimension) {
		case 'householdRole':
			return member.householdRoles.some((role) => sameToken(role, filter.value));
		case 'relationship':
			return sameToken(member.relationship, filter.value);
		case 'contactField': {
			const value = member.contactFields[filter.fieldKey];
			// No match value means "has any value", the same reading a `count`
			// field stat takes.
			return filter.matchValue === undefined
				? isSetValue(value)
				: sameToken(String(value ?? ''), filter.matchValue);
		}
	}
}

// ------------------------------------------------------------------
// Built-in sources
// ------------------------------------------------------------------

/**
 * Projects whose goal is met, within the window. A project marked goal-met but
 * carrying no goalMetAt cannot be placed in time, so a windowed read drops it;
 * a lifetime read (every public read) keeps it.
 */
function freedProjects(scope: StatScope, window: StatWindow | undefined): Doc<'projects'>[] {
	return scope.projects.filter(
		(project) => project.isGoalMet && withinWindow(project.goalMetAt, window)
	);
}

/**
 * People and children reached, counted across the goal-met projects. Reads the
 * shared member index rather than re-querying, so `people_reached` and a
 * member stat over the same records can never disagree about who is attached
 * to what — and donors are excluded once, in one place.
 *
 * Counted DISTINCT BY PERSON. Someone attached to two records is one person
 * reached, not two: this is a headline figure about human beings, and the same
 * child appearing twice because a family was split across records would
 * overstate it. It is the reading a member stat already takes, so a configured
 * "people in freed records" stat and this built-in agree by construction.
 */
function reachCounts(
	scope: StatScope,
	members: MemberRow[],
	window: StatWindow | undefined
): { people: number; children: number } {
	const freedIds = new Set(freedProjects(scope, window).map((project) => project._id as string));
	const reached = members.filter((member) => freedIds.has(member.projectId));
	return {
		people: new Set(reached.map((member) => member.contactId)).size,
		children: new Set(
			reached.filter((member) => isChildMember(member)).map((member) => member.contactId)
		).size
	};
}

/** Donation cents allocated to this campaign, within the window. */
async function raisedCents(
	ctx: QueryCtx,
	scope: StatScope,
	window: StatWindow | undefined
): Promise<number> {
	const allocations = await ctx.db
		.query('allocations')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', scope.campaign._id))
		.collect();

	let total = 0;
	const cache = new Map<string, Doc<'transactions'> | null>();
	for (const allocation of allocations) {
		const id = allocation.transactionId as string;
		let transaction = cache.get(id);
		if (transaction === undefined) {
			transaction = await ctx.db.get('transactions', allocation.transactionId);
			cache.set(id, transaction);
		}
		if (!transaction || transaction.type !== 'donation') continue;
		// occurredOn is the date the money moved; _creationTime is when it was
		// keyed in. The former is the truthful one when it is there.
		const at = transaction.occurredOn
			? Date.parse(transaction.occurredOn)
			: transaction._creationTime;
		if (!withinWindow(Number.isNaN(at) ? undefined : at, window)) continue;
		total += allocation.amountCents;
	}
	return total;
}

// ------------------------------------------------------------------
// Field source
// ------------------------------------------------------------------

/** Every non-empty value of a field across the in-scope projects. */
function fieldValues(scope: StatScope, fieldKey: string): unknown[] {
	return scope.projects
		.map((project) => project.attributes[fieldKey])
		.filter((value) => isSetValue(value));
}

function fieldStatValue(scope: StatScope, source: Extract<StatSource, { kind: 'field' }>): number {
	const values = fieldValues(scope, source.fieldKey);
	switch (source.aggregate) {
		case 'sum':
			return values.reduce<number>((sum, value) => {
				const n = typeof value === 'number' ? value : Number(value);
				return Number.isFinite(n) ? sum + n : sum;
			}, 0);
		case 'count':
			return values.length;
		case 'countWhere':
			return values.filter((value) => String(value) === source.matchValue).length;
	}
}

/**
 * The records a member stat looks at, before the people filter is applied.
 * `task` reuses the task-done set so "children enrolled in school" and
 * "families with school done" can never disagree about which records qualify.
 */
async function memberRecordIds(
	ctx: QueryCtx,
	scope: StatScope,
	among: Extract<StatSource, { kind: 'member' }>['among'],
	window: StatWindow | undefined
): Promise<Set<string>> {
	switch (among.kind) {
		case 'all':
			return new Set(scope.projectIds);
		case 'goalMet':
			return new Set(freedProjects(scope, window).map((project) => project._id as string));
		case 'task':
			return await taskDoneProjectIds(ctx, scope, among.impactTag, window);
	}
}

/**
 * The member count: people matching the filter on qualifying records, or the
 * records holding at least one such person.
 *
 * People are counted DISTINCT by contact within a record set — someone
 * attached to two records in the same campaign is one person reached, not two.
 */
async function memberStatValue(
	ctx: QueryCtx,
	scope: StatScope,
	source: Extract<StatSource, { kind: 'member' }>,
	members: MemberRow[],
	window: StatWindow | undefined
): Promise<number> {
	const recordIds = await memberRecordIds(ctx, scope, source.among, window);
	if (recordIds.size === 0) return 0;

	const matched = members.filter(
		(member) => recordIds.has(member.projectId) && matchesFilter(member, source.filter)
	);

	return source.count === 'records'
		? new Set(matched.map((member) => member.projectId)).size
		: new Set(matched.map((member) => member.contactId)).size;
}

/**
 * Rule 4: a `countWhere` stat publishes one slice of a distribution, so it may
 * only go out when EVERY non-empty bucket of that field clears the threshold.
 * Withholding just the small bucket would still tell a reader the field has a
 * rare value and roughly how rare.
 */
function everyBucketClearsThreshold(scope: StatScope, fieldKey: string): boolean {
	const counts = new Map<string, number>();
	for (const value of fieldValues(scope, fieldKey)) {
		const bucket = String(value);
		counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
	}
	for (const count of counts.values()) {
		if (count < scope.policy.countThreshold) return false;
	}
	return true;
}

// ------------------------------------------------------------------
// Task source
// ------------------------------------------------------------------

/**
 * count(DISTINCT projectId) over completed tasks carrying the tag — distinct,
 * so a record with two business milestones counts once rather than twice.
 *
 * There is no per-task publish gate: whether this number goes out is the
 * `showOnPublic` on the campaign's stat row for this tag, applied by the
 * caller. The count itself is the same figure whoever is asking.
 */
async function taskStatValue(
	ctx: QueryCtx,
	scope: StatScope,
	impactTag: string,
	window: StatWindow | undefined
): Promise<number> {
	return (await taskDoneProjectIds(ctx, scope, impactTag, window)).size;
}

/** The records where a task carrying this tag is done. Shared with member stats. */
async function taskDoneProjectIds(
	ctx: QueryCtx,
	scope: StatScope,
	impactTag: string,
	window: StatWindow | undefined
): Promise<Set<string>> {
	const rows = await ctx.db
		.query('tasks')
		.withIndex('by_campaignId_and_impactTag', (q) =>
			q.eq('campaignId', scope.campaign._id).eq('impactTag', impactTag)
		)
		.collect();

	const projectIds = new Set<string>();
	for (const task of rows) {
		if (task.status !== 'done') continue;
		if (!scope.projectIds.has(task.projectId as string)) continue;
		if (!withinWindow(task.completedAt, window)) continue;
		projectIds.add(task.projectId as string);
	}
	return projectIds;
}

// ------------------------------------------------------------------
// The engine
// ------------------------------------------------------------------

/**
 * Why a configured stat may not go to the public site, or null when it may.
 * The public read only needs "may it?", but the admin screen needs the reason —
 * a stat that silently fails to appear is worse than one that says why.
 */
export type StatPublicIssue =
	| 'unknown_metric'
	| 'missing_field'
	| 'private_field'
	| 'protected_key'
	| 'small_count'
	| 'small_bucket';

/** One configured stat, evaluated: its internal value plus its public verdict. */
export type EvaluatedStat = {
	id: string;
	label: string;
	format: StatFormat;
	lifetime: boolean;
	/** The number with no public gating — what the dashboard shows. */
	value: number;
	/** Why the public site cannot show this, or null when it can. */
	publicIssue: StatPublicIssue | null;
	/** What the public site would show. Null exactly when publicIssue is set. */
	publicValue: number | null;
	showOnPublic: boolean;
	showOnDashboard: boolean;
};

/**
 * Evaluate a campaign's whole selection: the internal number for every row, and
 * for every row a verdict on whether it may be published and what it would say.
 * This is the single place the rules live — `computeStats` is a filter over it,
 * so the public site, the dashboard and the admin warnings can never drift.
 */
export async function evaluateStats(
	ctx: QueryCtx,
	campaign: Doc<'campaigns'>,
	window?: StatWindow
): Promise<EvaluatedStat[]> {
	const configs = resolveStatConfigs(campaign.publicStats as StatConfig[] | undefined);
	if (configs.length === 0) return [];

	const scope = await loadScope(ctx, campaign);
	const labelCtx = {
		objectLabelPlural: campaign.objectLabelPlural,
		goalLabel: campaign.goalLabel
	};

	// The people index is the expensive read in this module, so it is built at
	// most once per call and only when something actually asks for people —
	// a member stat, or one of the reach built-ins.
	let members: MemberRow[] | null = null;
	const membersOnce = async () => (members ??= await loadMembers(ctx, scope));

	// Computed lazily and shared: several built-ins read the same rows. Keyed by
	// whether a window applies, because a public figure is always lifetime while
	// the dashboard's is not.
	const reachCache = new Map<string, { people: number; children: number }>();
	const reachOnce = async (w: StatWindow | undefined) => {
		const key = `${w?.from ?? ''}:${w?.to ?? ''}`;
		const hit = reachCache.get(key);
		if (hit) return hit;
		const computed = reachCounts(scope, await membersOnce(), w);
		reachCache.set(key, computed);
		return computed;
	};

	const builtinValue = async (metric: string, w: StatWindow | undefined): Promise<number> => {
		switch (metric) {
			case 'projects_freed':
				return freedProjects(scope, w).length;
			case 'people_reached':
				return (await reachOnce(w)).people;
			case 'children_reached':
				return (await reachOnce(w)).children;
			case 'total_raised':
				return await raisedCents(ctx, scope, w);
			default:
				return 0;
		}
	};

	const out: EvaluatedStat[] = [];
	for (const config of configs) {
		const source = config.source as StatSource;
		const evaluated = await evaluateOne(source);
		if (!evaluated) continue;
		out.push({
			id: config.id,
			label: config.label?.trim() || evaluated.label,
			format: evaluated.format,
			lifetime: evaluated.lifetime,
			value: evaluated.value,
			publicIssue: evaluated.publicIssue,
			publicValue: evaluated.publicValue,
			showOnPublic: config.showOnPublic,
			showOnDashboard: config.showOnDashboard
		});
	}
	return out;

	/** Null means the row names something that no longer exists at all. */
	async function evaluateOne(source: StatSource): Promise<{
		label: string;
		format: StatFormat;
		lifetime: boolean;
		value: number;
		publicIssue: StatPublicIssue | null;
		publicValue: number | null;
	} | null> {
		if (source.kind === 'builtin') {
			if (!isStatMetricKey(source.metric)) {
				return {
					label: source.metric,
					format: 'count',
					lifetime: false,
					value: 0,
					publicIssue: 'unknown_metric',
					publicValue: null
				};
			}
			const metric = STAT_METRICS[source.metric];
			const value = await builtinValue(source.metric, window);
			// Public is always lifetime, whatever window a caller passed.
			const publicValue =
				window === undefined ? value : await builtinValue(source.metric, undefined);
			return {
				label: resolveStatLabel(metric, labelCtx),
				format: metric.format,
				lifetime: false,
				value,
				publicIssue: gate(source, metric.format, publicValue),
				publicValue
			};
		}

		if (source.kind === 'field') {
			const def = scope.defs.get(source.fieldKey);
			// A stat over a field that no longer exists renders nothing rather
			// than a zero that would read as a real measurement.
			if (!def) {
				return {
					label: source.fieldKey,
					format: 'count',
					lifetime: true,
					value: 0,
					publicIssue: 'missing_field',
					publicValue: null
				};
			}
			const value = fieldStatValue(scope, source);
			const format: StatFormat =
				source.aggregate === 'sum' && def.type === 'money' ? 'money' : 'count';

			// Checked in this order so the most fundamental reason wins: a
			// protected key can never be published however the flags are set.
			const issue: StatPublicIssue | null = isProtectedFieldKey(
				def.key,
				scope.policy.extraProtectedKeys
			)
				? 'protected_key'
				: !def.isPublic
					? 'private_field'
					: source.aggregate === 'countWhere' && !everyBucketClearsThreshold(scope, def.key)
						? 'small_bucket'
						: gate(source, format, value);

			return {
				label: def.label,
				format,
				// No custom field carries a timestamp, so a field stat is always
				// the lifetime figure even inside a filtered dashboard.
				lifetime: true,
				value,
				publicIssue: issue,
				publicValue: issue === null ? value : null
			};
		}

		if (source.kind === 'member') {
			const filter = source.filter;
			const label = memberStatLabel(
				source,
				labelCtx,
				(key) => scope.contactDefs.get(key)?.label ?? key
			);

			// A contact-field filter is only publishable on the same terms a
			// field stat is: the definition must exist, be public, and not be a
			// protected key. The count is over people, so this is the sharpest
			// place in the module for a private field to leak.
			let issue: StatPublicIssue | null = null;
			if (filter?.dimension === 'contactField') {
				const def = scope.contactDefs.get(filter.fieldKey);
				if (!def) issue = 'missing_field';
				else if (isProtectedFieldKey(def.key)) issue = 'protected_key';
				else if (!def.isPublic) issue = 'private_field';
			}
			if (issue !== null) {
				return {
					label,
					format: 'count',
					lifetime: false,
					value: 0,
					publicIssue: issue,
					publicValue: null
				};
			}

			const rows = await membersOnce();
			const value = await memberStatValue(ctx, scope, source, rows, window);
			const publicValue =
				window === undefined ? value : await memberStatValue(ctx, scope, source, rows, undefined);
			const gated = gate(source, 'count', publicValue);
			return {
				label,
				format: 'count',
				// `all` has no timestamp to filter on; the other two do.
				lifetime: source.among.kind === 'all',
				value,
				publicIssue: gated,
				publicValue: gated === null ? publicValue : null
			};
		}

		const value = await taskStatValue(ctx, scope, source.impactTag, window);
		// The public figure is the same count, but always over all time.
		const publicValue =
			window === undefined ? value : await taskStatValue(ctx, scope, source.impactTag, undefined);
		const issue = gate(source, 'count', publicValue);
		return {
			label: humanizeToken(source.impactTag),
			format: 'count',
			lifetime: false,
			value,
			publicIssue: issue,
			publicValue: issue === null ? publicValue : null
		};
	}

	function gate(source: StatSource, format: StatFormat, value: number): StatPublicIssue | null {
		return suppressesPublicValue(source, format, value, scope.policy.countThreshold)
			? 'small_count'
			: null;
	}
}

/**
 * Every configured stat for one surface, in the campaign's own order. On the
 * public surface a row whose source cannot be published is DROPPED, not
 * rendered, so the caller shows whatever comes back without re-checking.
 */
export async function computeStats(
	ctx: QueryCtx,
	campaign: Doc<'campaigns'>,
	options: ComputeStatsOptions
): Promise<ResolvedStat[]> {
	const isPublic = options.surface === 'public';
	// Public is always lifetime, whatever a caller passes.
	const evaluated = await evaluateStats(ctx, campaign, isPublic ? undefined : options.window);

	return evaluated
		.filter((stat) => (isPublic ? stat.showOnPublic : stat.showOnDashboard))
		.filter((stat) => !isPublic || stat.publicIssue === null)
		.map((stat) => ({
			key: stat.id,
			label: stat.label,
			value: isPublic ? (stat.publicValue ?? 0) : stat.value,
			format: stat.format,
			lifetime: stat.lifetime
		}));
}

/**
 * The impact numbers an org has chosen to surface on its own page: one section
 * per selected campaign, each reusing that campaign's own public selection.
 * Nothing new is computed, so a stat cannot say one thing on a campaign page
 * and another here.
 */
export type PublicStatSection = {
	campaignSlug: string;
	heading: string;
	stats: ResolvedStat[];
};

export async function publicStatSections(
	ctx: QueryCtx,
	settings: Doc<'orgSettings'>
): Promise<PublicStatSection[]> {
	const sections = [...(settings.publicStatSections ?? [])].sort((a, b) => a.order - b.order);
	const out: PublicStatSection[] = [];

	for (const section of sections) {
		const campaign = await ctx.db.get('campaigns', section.campaignId);
		// Same gate as every other public read: an unpublished campaign does not
		// exist here, and neither does one belonging to another org.
		if (!campaign || campaign.orgId !== settings.orgId || !campaign.isPublished) continue;

		const stats = await computeStats(ctx, campaign, { surface: 'public' });
		// A section with nothing to show is an empty heading on a donor page.
		if (stats.length === 0) continue;

		out.push({
			campaignSlug: campaign.slug,
			heading: section.heading?.trim() || campaign.name,
			stats
		});
	}

	return out;
}
