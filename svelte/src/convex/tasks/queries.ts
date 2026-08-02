// ============================================================
// Reading tasks
// ============================================================
// FILTERING HAPPENS HERE, not on the client. `matchesFilters` in the pure
// module can judge everything except the assignee, because "assigned to me"
// needs the user↔contact link and a pure module has no db. Rather than split
// the work — some filters server-side, one filter client-side — the whole set
// is applied here, where the link is resolvable. The client hands over its
// parsed URL state and gets back rows it can render.
//
// No clock is read. "Overdue" is `isOverdue(task, today)` on the client with a
// `today` it owns, because a query that read the clock would go stale with no
// write and would poison the query cache for every other viewer.
// ============================================================

import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { authComponent, createAuth } from '../auth';
import { activeOrgId } from '../model/auth';
import { getAccess } from '../model/access';
import { activeTaskTemplate, listProjectTasks } from '../model/tasks';
import {
	BULK_TASK_MAX,
	TASK_FACET_MAX,
	TASK_FACET_OPTION_MAX,
	TASK_PAGE_MAX,
	matchesResolvedAssignee,
	publicTaskStatLabel,
	resolveAssigneeFilter,
	resolvePersonIdentity,
	taskAssigneeFilterValidator,
	taskPriorityValidator,
	taskSortDirValidator,
	taskSortValidator,
	taskStatusFilterValidator,
	TASK_VIEW_MAX,
	type ResolvedAssigneeFilter
} from '../model/taskViews';
import { can, visibleCampaignIds } from '../../lib/domain/permissions';
import { compareTasks, matchesFilters } from '../../lib/features/tasks/filters';
import type { TaskFilters, TaskPriority } from '../../lib/features/tasks/types';
import { contactDisplayName } from '../../lib/features/contacts/contact-name';

// An org's campaigns are a bounded set (tens), and org scope needs their names
// for its Campaign column anyway, so one read serves both scoping and display.
const CAMPAIGN_MAX = 200;

// The assignee picker's contact half. A picker that silently ends is worse than
// one that says it did, so the caller is told when this bit.
const ASSIGNABLE_CONTACT_MAX = 500;

/** Typed, so the guard clauses do not infer `never[]` and widen the row shape. */
const EMPTY_CHECKLIST: {
	tasks: HydratedTask[];
	pendingTemplateItems: number;
	hasActiveTemplate: boolean;
} = { tasks: [], pendingTemplateItems: 0, hasActiveTemplate: false };

/**
 * A project's checklist. Returns the task rows plus how many items the
 * campaign's active template holds that this project has not been given yet,
 * so the UI can offer to fill them in without a second query.
 *
 * Named for the surface it serves rather than for its table: `listTasks` below
 * is the scoped LIST, and the two answer different questions about the same
 * rows — this one is ordered by the checklist and knows about templates.
 *
 * Rows are hydrated by the SAME joiner the list uses. The checklist shows an
 * assignee and hands a row straight to the shared sheet, and a second, thinner
 * row shape would be one the two surfaces are free to drift apart on.
 */
export const listProjectChecklist = query({
	args: { projectId: v.id('projects') },
	handler: async (ctx, args) => {
		const orgId = await activeOrgId(ctx);
		if (!orgId) return EMPTY_CHECKLIST;

		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== orgId) return EMPTY_CHECKLIST;

		const tasks = await listProjectTasks(ctx, args.projectId);
		const template = await activeTaskTemplate(ctx, project.campaignId);
		const have = new Set(tasks.map((task) => task.key));

		// One campaign, because one record belongs to exactly one.
		const campaign = await ctx.db.get('campaigns', project.campaignId);

		return {
			tasks: await hydrateTasks(
				ctx,
				tasks,
				new Map(campaign ? [[campaign._id as string, campaign]] : [])
			),
			pendingTemplateItems: (template?.items ?? []).filter((item) => !have.has(item.key)).length,
			hasActiveTemplate: template !== null
		};
	}
});

// ------------------------------------------------------------------
// The list
// ------------------------------------------------------------------

/** One row, with everything the table renders joined on. */
type HydratedTask = Doc<'tasks'> & {
	/** Null for unassigned AND for an id that no longer resolves — see the spec's edge cases. */
	assigneeName: string | null;
	projectNumber: string | null;
	projectName: string | null;
	campaignName: string | null;
	/** A stage key that no longer resolves renders muted, so the raw key is the fallback. */
	stageLabel: string | null;
};

const EMPTY_LIST: { tasks: HydratedTask[]; truncated: boolean } = { tasks: [], truncated: false };

/**
 * Read one bounded page off the most selective index available.
 *
 * With a status filter — the default, `todo` — the status index wins because it
 * is the narrower read. The cost is that its 500 is an ARBITRARY slice in
 * creation order rather than the 500 nearest deadlines, which is precisely why
 * the caller is handed `truncated` and the UI says so out loud.
 *
 * With `status: 'all'` there is nothing to be selective about, so the read
 * moves to the `dueOn` index and comes back already in the default sort order.
 */
async function readCampaignPage(
	ctx: QueryCtx,
	campaignId: Id<'campaigns'>,
	status: 'todo' | 'done' | 'all',
	take: number
): Promise<Doc<'tasks'>[]> {
	if (status === 'all') {
		return await ctx.db
			.query('tasks')
			.withIndex('by_campaignId_and_dueOn', (q) => q.eq('campaignId', campaignId))
			.take(take);
	}
	return await ctx.db
		.query('tasks')
		.withIndex('by_campaignId_and_status', (q) =>
			q.eq('campaignId', campaignId).eq('status', status)
		)
		.take(take);
}

async function readOrgPage(
	ctx: QueryCtx,
	orgId: string,
	status: 'todo' | 'done' | 'all',
	take: number
): Promise<Doc<'tasks'>[]> {
	if (status === 'all') {
		return await ctx.db
			.query('tasks')
			.withIndex('by_orgId_and_dueOn', (q) => q.eq('orgId', orgId))
			.take(take);
	}
	return await ctx.db
		.query('tasks')
		.withIndex('by_orgId_and_status', (q) => q.eq('orgId', orgId).eq('status', status))
		.take(take);
}

/**
 * Which indexes a scoped read covers: `null` for the org-wide one, a list for
 * "these campaigns, merged", `'denied'` for nothing the caller may see.
 *
 * Shared by the list and the facets deliberately. A dropdown computed over a
 * WIDER set than the list reads would offer options that select into an empty
 * page, and a narrower one would hide values that are really there — so the two
 * surfaces resolve their scope through the same function rather than each
 * writing down the same four branches.
 */
type TaskReadScope = Id<'campaigns'>[] | null;

function resolveTaskScope(
	access: Awaited<ReturnType<typeof getAccess>>,
	campaigns: Doc<'campaigns'>[],
	campaignsById: Map<string, Doc<'campaigns'>>,
	scope: 'campaign' | 'org',
	campaignId: Id<'campaigns'> | undefined
): TaskReadScope | 'denied' {
	// A saved view may name a campaign the viewer cannot access. That is checked
	// rather than trusted: applying a view narrows to what they may see and never
	// widens.
	if (campaignId) {
		if (!campaignsById.has(campaignId)) return 'denied';
		if (!can(access, 'projects:read', campaignId)) return 'denied';
		return [campaignId];
	}
	// A campaign page with no campaign chosen shows nothing, where an org page
	// with no campaign filter shows everything the caller may see.
	if (scope === 'campaign') return 'denied';
	if (!can(access, 'projects:read')) return 'denied';
	if (access.role === 'owner' || access.role === 'admin') return null;

	// A team leader sees a slice of the org. Reading the org index and dropping
	// what they may not see would spend the page budget on rows they never get,
	// and report truncation that is not theirs — so their own campaigns are read
	// directly instead.
	const visible = new Set(
		visibleCampaignIds(
			access,
			campaigns.map((campaign) => campaign._id as string)
		)
	);
	return campaigns
		.filter((campaign) => visible.has(campaign._id as string))
		.map((campaign) => campaign._id);
}

/** One bounded read over a resolved scope. `take` is the whole budget, merged. */
async function readScope(
	ctx: QueryCtx,
	orgId: string,
	scope: TaskReadScope,
	status: 'todo' | 'done' | 'all',
	take: number
): Promise<Doc<'tasks'>[]> {
	if (scope === null) return await readOrgPage(ctx, orgId, status, take);

	const rows: Doc<'tasks'>[] = [];
	for (const campaignId of scope) {
		const remaining = take - rows.length;
		if (remaining <= 0) break;
		rows.push(...(await readCampaignPage(ctx, campaignId, status, remaining)));
	}
	return rows;
}

/**
 * Better Auth holds the member list, not our tables, so a user assignee's name
 * comes from there. Names are DECORATION: if the auth component is unreachable
 * the list still renders, with those rows reading "Unassigned" rather than the
 * whole query failing.
 */
async function orgMemberNames(ctx: QueryCtx): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	try {
		const auth = createAuth(ctx);
		const organization = await auth.api.getFullOrganization({
			headers: await authComponent.getHeaders(ctx)
		});
		for (const member of organization?.members ?? []) {
			const name = member.user?.name?.trim() || member.user?.email?.trim();
			if (name) names.set(member.userId, name);
		}
	} catch {
		// Deliberately silent — see above.
	}
	return names;
}

/**
 * Join on what a row displays. Every lookup is deduped first: the page is
 * capped at 500 rows but they commonly share a handful of projects, campaigns
 * and assignees, so this is nearer a dozen reads than five hundred.
 */
async function hydrateTasks(
	ctx: QueryCtx,
	rows: Doc<'tasks'>[],
	campaignsById: Map<string, Doc<'campaigns'>>
): Promise<HydratedTask[]> {
	if (rows.length === 0) return [];

	const projects = new Map<string, Doc<'projects'> | null>();
	for (const projectId of new Set(rows.map((row) => row.projectId).filter(Boolean))) {
		projects.set(projectId as string, await ctx.db.get('projects', projectId as Id<'projects'>));
	}

	const contacts = new Map<string, Doc<'contacts'> | null>();
	for (const contactId of new Set(
		rows.flatMap((row) => (row.assignee?.kind === 'contact' ? [row.assignee.contactId] : []))
	)) {
		contacts.set(contactId as string, await ctx.db.get('contacts', contactId));
	}

	// Stage labels are per campaign, and only campaigns actually present on the
	// page are read.
	const stageLabels = new Map<string, string>();
	for (const campaignId of new Set(rows.map((row) => row.campaignId as string))) {
		const stages = await ctx.db
			.query('pipelineStages')
			.withIndex('by_campaignId_and_order', (q) =>
				q.eq('campaignId', campaignId as Id<'campaigns'>)
			)
			.collect();
		for (const stage of stages) stageLabels.set(`${campaignId}:${stage.key}`, stage.label);
	}

	const userNames = rows.some((row) => row.assignee?.kind === 'user')
		? await orgMemberNames(ctx)
		: new Map<string, string>();

	return rows.map((row) => {
		const project = row.projectId ? projects.get(row.projectId) : null;
		const contact = row.assignee?.kind === 'contact' ? contacts.get(row.assignee.contactId) : null;

		let assigneeName: string | null = null;
		if (row.assignee?.kind === 'user') assigneeName = userNames.get(row.assignee.userId) ?? null;
		else if (contact) assigneeName = contactDisplayName(contact);

		return {
			...row,
			assigneeName,
			projectNumber: project?.number ?? null,
			projectName: project?.name ?? null,
			campaignName: campaignsById.get(row.campaignId as string)?.name ?? null,
			// A key that no longer resolves falls back to itself rather than to
			// blank, matching how a project's own stage renders.
			stageLabel: row.stageKey
				? (stageLabels.get(`${row.campaignId}:${row.stageKey}`) ?? row.stageKey)
				: null
		};
	});
}

/**
 * The one list behind both task pages. `scope` is the only thing that differs:
 * the campaign page passes `'campaign'` with its active campaign, the admin
 * page passes `'org'` and may pass a campaign as a FILTER instead.
 *
 * `campaignId` therefore serves both roles, because the read it produces is the
 * same either way — one campaign, off the campaign index. What `scope` actually
 * decides is the empty case: a campaign page with no campaign chosen shows
 * nothing, where an org page with no campaign filter shows everything the
 * caller may see.
 *
 * A saved view may name a campaign the viewer cannot access. That is checked
 * here rather than trusted: applying a view narrows to what they may see and
 * never widens.
 */
export const listTasks = query({
	args: {
		scope: v.union(v.literal('campaign'), v.literal('org')),
		campaignId: v.optional(v.id('campaigns')),
		assignee: v.optional(taskAssigneeFilterValidator),
		priority: v.optional(v.array(taskPriorityValidator)),
		status: v.optional(taskStatusFilterValidator),
		stageKey: v.optional(v.string()),
		// A plain string, deliberately, for the reason `taskAssigneeFilterValidator`
		// is: this arrives from a hand-edited URL or a saved view written against
		// another org's data, and `v.id('projects')` would answer junk with an
		// argument validation error — a stack trace where the parser's whole
		// posture is that a broken filter shows the default list.
		projectId: v.optional(v.string()),
		dueAfter: v.optional(v.string()),
		dueBefore: v.optional(v.string()),
		sort: v.optional(taskSortValidator),
		dir: v.optional(taskSortDirValidator),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId || !access.role) return EMPTY_LIST;
		const orgId = access.orgId;

		const campaigns = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.take(CAMPAIGN_MAX);
		const campaignsById = new Map(campaigns.map((campaign) => [campaign._id as string, campaign]));

		const scope = resolveTaskScope(access, campaigns, campaignsById, args.scope, args.campaignId);
		if (scope === 'denied') return EMPTY_LIST;

		const status = args.status ?? 'todo';
		const budget = Math.max(1, Math.min(args.limit ?? TASK_PAGE_MAX, TASK_PAGE_MAX));

		// One over the budget, so "there are more" is a fact rather than the guess
		// that a full page implies one.
		let rows = await readScope(ctx, orgId, scope, status, budget + 1);
		const truncated = rows.length > budget;
		rows = rows.slice(0, budget);

		// The assignee filter is resolved ONCE for the page rather than per row —
		// it costs a db read, and the answer is the same for every row.
		const viewer = await resolvePersonIdentity(ctx, orgId, { userId: access.userId ?? undefined });
		const resolvedAssignee: ResolvedAssigneeFilter | null = await resolveAssigneeFilter(
			ctx,
			orgId,
			args.assignee,
			viewer
		);

		// normalizeId is how "is this even an id" gets asked without ctx.db.get
		// throwing. An id naming nothing falls back to NO record filter rather
		// than to a filter nothing can satisfy — a broken param must not present
		// itself as an empty list.
		const projectId = args.projectId
			? (ctx.db.normalizeId('projects', args.projectId) ?? undefined)
			: undefined;

		// Everything except the assignee goes through the pure module, so the
		// server and the tests agree by construction on what a filter means.
		const filters: TaskFilters = {
			priority: (args.priority ?? []) as TaskPriority[],
			status,
			stageKey: args.stageKey,
			campaignId: args.campaignId,
			projectId,
			dueAfter: args.dueAfter,
			dueBefore: args.dueBefore,
			sort: args.sort ?? 'dueOn',
			dir: args.dir ?? 'asc'
		};

		const matched = rows.filter(
			(row) =>
				matchesFilters(row, filters) && matchesResolvedAssignee(row.assignee, resolvedAssignee)
		);

		// Hydrated BEFORE sorting, not after: the record sort orders on the
		// record's display NUMBER, and that number only exists once the project is
		// joined on. Sorting the raw rows would silently tie every row and fall
		// through to the label.
		const hydrated = await hydrateTasks(ctx, matched, campaignsById);
		hydrated.sort((a, b) => compareTasks(a, b, filters.sort, filters.dir));

		return { tasks: hydrated, truncated };
	}
});

// ------------------------------------------------------------------
// The pickers
// ------------------------------------------------------------------

/**
 * Everyone a task can be put on: org members first, then contacts.
 *
 * Both, in one query, because they are one choice in the UI and the assignee
 * column does not care which table a person came from. `campaignId` is the
 * permission scope rather than a filter — a team leader asks about a campaign
 * they hold, and gets the org's people, because a contact's identity is
 * campaign-agnostic.
 *
 * DELIBERATELY COMPLETE, and it must stay that way. This feeds the PICKER —
 * assigning work — and you cannot put a task on someone the list left out, so
 * "only people who already have tasks" is exactly the wrong set here. The
 * narrowing the FILTER wants is `listTaskFacets` below; the two lists of people
 * answer different questions and must not converge.
 */
export const listAssignableMembers = query({
	args: { campaignId: v.optional(v.id('campaigns')) },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		const empty = { users: [], contacts: [], contactsTruncated: false };
		if (!access.orgId || !can(access, 'projects:read', args.campaignId ?? null)) return empty;

		const names = await orgMemberNames(ctx);
		const users = [...names.entries()]
			.map(([userId, name]) => ({ userId, name }))
			.sort((a, b) => a.name.localeCompare(b.name));

		// One over the cap, for the same reason the task page reads one over: the
		// picker says when it is showing a subset instead of pretending otherwise.
		const rows = await ctx.db
			.query('contacts')
			.withIndex('by_orgId', (q) => q.eq('orgId', access.orgId!))
			.take(ASSIGNABLE_CONTACT_MAX + 1);
		const contactsTruncated = rows.length > ASSIGNABLE_CONTACT_MAX;

		const contacts = rows
			.slice(0, ASSIGNABLE_CONTACT_MAX)
			.map((contact) => ({
				contactId: contact._id,
				name: contactDisplayName(contact),
				email: contact.email ?? null,
				// The picker can mark the row as the same person as a member — this
				// is the link that makes "assigned to me" match either id.
				authUserId: contact.authUserId ?? null
			}))
			.sort((a, b) => a.name.localeCompare(b.name));

		return { users, contacts, contactsTruncated };
	}
});

// ------------------------------------------------------------------
// What the filters can actually offer
// ------------------------------------------------------------------

/** The values each narrowing filter has rows behind it. Names already resolved. */
type TaskFacets = {
	assignees: {
		users: { userId: string; name: string }[];
		contacts: { contactId: Id<'contacts'>; name: string }[];
		/** Whether anything in scope is on nobody, and whether anything is on the viewer. */
		unassigned: boolean;
		mine: boolean;
	};
	campaigns: { _id: Id<'campaigns'>; name: string }[];
	projects: { _id: Id<'projects'>; number: string; name: string }[];
	stages: { key: string; label: string }[];
	/** The scan hit its bound, so a rarely used value may be missing. Said out loud. */
	truncated: boolean;
};

const EMPTY_FACETS: TaskFacets = {
	assignees: { users: [], contacts: [], unassigned: false, mine: false },
	campaigns: [],
	projects: [],
	stages: [],
	truncated: false
};

/**
 * Which values the assignee, campaign, record and stage filters can offer —
 * only the ones that actually occur, so the dropdowns are a shortlist of what
 * is there rather than a catalogue of what could be.
 *
 * COMPUTED OVER THE SCOPE, NOT OVER THE FILTERED SET. The applied assignee,
 * record, stage, priority and dates are all ignored on purpose: a facet derived
 * from the filtered rows would delete every other option the moment one was
 * picked, and there would be no way to switch from person A to person B.
 *
 * STATUS IS THE EXCEPTION and is passed in. It defaults to `todo`, so a person
 * whose only tasks are done would otherwise be a live-looking option that
 * selects into an empty list — a dead end the other filters do not have,
 * because nothing else has a default that hides rows.
 *
 * A SEPARATE READ from `listTasks`, bounded by `TASK_FACET_MAX`. Deriving the
 * options from the returned page would hide every value that only exists past
 * `TASK_PAGE_MAX`, which is the failure this query exists to avoid.
 */
export const listTaskFacets = query({
	args: {
		scope: v.union(v.literal('campaign'), v.literal('org')),
		campaignId: v.optional(v.id('campaigns')),
		status: v.optional(taskStatusFilterValidator)
	},
	handler: async (ctx, args): Promise<TaskFacets> => {
		const access = await getAccess(ctx);
		if (!access.orgId || !access.role) return EMPTY_FACETS;
		const orgId = access.orgId;

		const campaigns = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.take(CAMPAIGN_MAX);
		const campaignsById = new Map(campaigns.map((campaign) => [campaign._id as string, campaign]));

		const scope = resolveTaskScope(access, campaigns, campaignsById, args.scope, args.campaignId);
		if (scope === 'denied') return EMPTY_FACETS;

		const status = args.status ?? 'todo';
		const budget = TASK_FACET_MAX;

		// One over, so "there are more" is a fact rather than the guess that a full
		// scan implies one — the same shape as the list's own `truncated`.
		const read = await readScope(ctx, orgId, scope, status, budget + 1);
		let truncated = read.length > budget;
		const rows = read.slice(0, budget);

		// The CAMPAIGN facet is the one that must not be narrowed by the campaign
		// filter. Narrowed, it would hold only the campaign already chosen and there
		// would be no way back to any other — so when a campaign is filtered on the
		// org page the wider scope is read a second time, for this list alone.
		let campaignRows = rows;
		if (args.scope === 'org' && args.campaignId) {
			const wide = resolveTaskScope(access, campaigns, campaignsById, 'org', undefined);
			if (wide === 'denied') {
				campaignRows = [];
			} else {
				const wideRead = await readScope(ctx, orgId, wide, status, budget + 1);
				truncated = truncated || wideRead.length > budget;
				campaignRows = wideRead.slice(0, budget);
			}
		}

		// ----- Assignees
		const userIds = new Set<string>();
		const contactIds = new Set<Id<'contacts'>>();
		let unassigned = false;
		for (const row of rows) {
			if (!row.assignee) unassigned = true;
			else if (row.assignee.kind === 'user') userIds.add(row.assignee.userId);
			else contactIds.add(row.assignee.contactId);
		}

		// A contact LINKED to a member is the same human as that member, and
		// `resolveAssigneeFilter` already matches a person through either id — so the
		// contact folds into the member half rather than appearing as a second row
		// for the same person. Its display name is kept as the fallback for when
		// Better Auth has no name for them, or is unreachable.
		const linkedNames = new Map<string, string>();
		const contacts: { contactId: Id<'contacts'>; name: string }[] = [];
		let looked = 0;
		for (const contactId of contactIds) {
			if (looked >= TASK_FACET_OPTION_MAX) {
				truncated = true;
				break;
			}
			looked += 1;
			const contact = await ctx.db.get('contacts', contactId);
			if (!contact || contact.orgId !== orgId) continue;
			if (contact.authUserId) {
				linkedNames.set(contact.authUserId, contactDisplayName(contact));
				continue;
			}
			contacts.push({ contactId, name: contactDisplayName(contact) });
		}
		for (const userId of linkedNames.keys()) userIds.add(userId);

		const memberNames = userIds.size > 0 ? await orgMemberNames(ctx) : new Map<string, string>();
		const users = [...userIds]
			.map((userId) => ({ userId, name: memberNames.get(userId) ?? linkedNames.get(userId) ?? '' }))
			// An id with no name left is someone who has left the org: there is nothing
			// to print on the option, and a raw id is not a name.
			.filter((user) => user.name !== '')
			.sort((a, b) => a.name.localeCompare(b.name));

		// "Assigned to me" is a person like any other, so it is offered only when the
		// viewer has something in scope. Judged by the ONE rule, never re-derived.
		const viewer = await resolvePersonIdentity(ctx, orgId, { userId: access.userId ?? undefined });
		const mineFilter: ResolvedAssigneeFilter = { kind: 'person', person: viewer };
		const mine = rows.some((row) => matchesResolvedAssignee(row.assignee, mineFilter));

		// ----- Campaigns
		const facetCampaigns = [...new Set(campaignRows.map((row) => row.campaignId as string))]
			.flatMap((campaignId) => {
				const campaign = campaignsById.get(campaignId);
				return campaign ? [{ _id: campaign._id, name: campaign.name }] : [];
			})
			.sort((a, b) => a.name.localeCompare(b.name));

		// ----- Records and stages
		// Both belong to exactly one campaign, so neither is meaningful until one is
		// in play — which is also when the UI offers them at all.
		const projects: { _id: Id<'projects'>; number: string; name: string }[] = [];
		const stages: { key: string; label: string }[] = [];

		if (args.campaignId) {
			const projectIds = new Set(rows.flatMap((row) => (row.projectId ? [row.projectId] : [])));
			looked = 0;
			for (const projectId of projectIds) {
				if (looked >= TASK_FACET_OPTION_MAX) {
					truncated = true;
					break;
				}
				looked += 1;
				const project = await ctx.db.get('projects', projectId);
				if (!project || project.orgId !== orgId) continue;
				projects.push({ _id: project._id, number: project.number, name: project.name });
			}
			// A record number is a prefix and a counter, only padded to three digits —
			// the same numeric compare the record sort uses, for the same reason.
			projects.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

			const stageKeys = new Set(rows.flatMap((row) => (row.stageKey ? [row.stageKey] : [])));
			const defined = await ctx.db
				.query('pipelineStages')
				.withIndex('by_campaignId_and_order', (q) => q.eq('campaignId', args.campaignId!))
				.collect();
			// Pipeline order, because that is the order the stage means something in.
			for (const stage of defined) {
				if (stageKeys.delete(stage.key)) stages.push({ key: stage.key, label: stage.label });
			}
			// A key the campaign no longer defines still has rows behind it, so it stays
			// filterable and falls back to itself — the same way the table renders it.
			for (const key of stageKeys) stages.push({ key, label: key });
		}

		return {
			assignees: { users, contacts, unassigned, mine },
			campaigns: facetCampaigns,
			projects,
			stages,
			truncated
		};
	}
});

/**
 * The viewer's own saved views plus the org's shared ones.
 *
 * `isOwn` rides along because it is what the UI gates rename and delete on, and
 * deriving it client-side would mean shipping the owner's user id to everyone
 * who can see a shared view.
 */
export const listTaskViews = query({
	args: {},
	handler: async (ctx) => {
		const access = await getAccess(ctx);
		if (!access.orgId || !access.userId || !can(access, 'projects:read')) return [];
		const { orgId, userId } = access;

		const own = await ctx.db
			.query('taskViews')
			.withIndex('by_orgId_and_ownerUserId', (q) => q.eq('orgId', orgId).eq('ownerUserId', userId))
			.take(TASK_VIEW_MAX);
		const shared = await ctx.db
			.query('taskViews')
			.withIndex('by_orgId_and_isShared', (q) => q.eq('orgId', orgId).eq('isShared', true))
			.take(TASK_VIEW_MAX);

		// A shared view the viewer owns is in both reads; it is one view.
		const byId = new Map(
			[...own, ...shared].map((view) => [
				view._id as string,
				{
					_id: view._id,
					name: view.name,
					query: view.query,
					isShared: view.isShared,
					order: view.order,
					isOwn: view.ownerUserId === userId
				}
			])
		);

		return [...byId.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
	}
});

// ------------------------------------------------------------------
// Naming the consequence
// ------------------------------------------------------------------

/**
 * Which of these tasks sit behind a number on the donor page.
 *
 * A query rather than a mutation return value, because the confirm has to say
 * it BEFORE the click: deleting a completed tagged task reduces a published
 * figure, and bulk-completing tagged ones raises it. The caller is handed the
 * facts — status and the stat's public label — and phrases the sentence, since
 * only it knows which of the two is about to happen.
 *
 * Rows whose stat is not published are omitted entirely: an empty result means
 * "nothing to warn about", which is the question being asked.
 */
export const listTaskImpactWarnings = query({
	args: { taskIds: v.array(v.id('tasks')) },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId || !access.role) return [];

		const campaigns = new Map<string, Doc<'campaigns'> | null>();
		const warnings: {
			taskId: Id<'tasks'>;
			label: string;
			impactTag: string;
			statLabel: string;
			status: 'todo' | 'done';
		}[] = [];

		for (const taskId of args.taskIds.slice(0, BULK_TASK_MAX)) {
			const task = await ctx.db.get('tasks', taskId);
			if (!task || task.orgId !== access.orgId || !task.impactTag) continue;
			// An untagged task moves no stat, and a task with no project counts
			// toward none — writes refuse that combination, so this is belt and
			// braces for rows written before the rule existed.
			if (!task.projectId) continue;
			if (!can(access, 'projects:read', task.campaignId)) continue;

			const key = task.campaignId as string;
			if (!campaigns.has(key)) campaigns.set(key, await ctx.db.get('campaigns', task.campaignId));
			const campaign = campaigns.get(key);
			if (!campaign) continue;

			const statLabel = publicTaskStatLabel(campaign, task.impactTag);
			if (!statLabel) continue;

			warnings.push({
				taskId: task._id,
				label: task.label,
				impactTag: task.impactTag,
				statLabel,
				status: task.status
			});
		}

		return warnings;
	}
});
