// ============================================================
// Writing tasks
// ============================================================
// Two kinds of task live in one table, told apart by `source`. Almost every
// write treats them alike; the exceptions are the three columns a template task
// SNAPSHOTTED from its checklist item — `label`, `key` and `impactTag`. Those
// are refused here rather than merely disabled in the sheet, because editing
// them per record would make two records disagree about what the same step
// means, and a disabled input is not a rule.
//
// Every write is `projects:write`, scoped to the task's own campaign.
//
// CLEARING vs LEAVING ALONE. Convex cannot tell an omitted argument from one
// passed as `undefined`, and a due date or an assignee genuinely needs to be
// removable. So the optional patch fields take `null` to mean CLEAR and absence
// to mean LEAVE ALONE. Anything that stores `undefined` drops the column, which
// is what keeps an unset `impactTag` out of by_campaignId_and_impactTag.
// ============================================================

import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireCapability } from '../model/access';
import { campaignStages } from '../model/projects';
import { instantiateTasks, requireTaskProject } from '../model/tasks';
import {
	BULK_TASK_MAX,
	TASK_VIEW_MAX,
	publicTaskStatLabel,
	taskAssigneeValidator,
	taskPriorityValidator,
	taskStatusValidator
} from '../model/taskViews';
import { can } from '../../lib/domain/permissions';

/** `null` clears the column; an absent argument leaves it alone. See the header. */
const clearableString = v.optional(v.union(v.string(), v.null()));
const clearableAssignee = v.optional(v.union(taskAssigneeValidator, v.null()));

const IMPACT_TAG_NEEDS_PROJECT =
	'An impact tag needs a project. Impact stats count distinct projects, so a tagged task with no project would count zero forever and look broken.';

function templateFieldRefusal(field: string): string {
	return `A checklist task's ${field} comes from the template version it was created against, and is the same on every record that carries it. Edit the checklist to change it.`;
}

async function requireTask(
	ctx: MutationCtx,
	orgId: string,
	taskId: Id<'tasks'>
): Promise<Doc<'tasks'>> {
	const task = await ctx.db.get('tasks', taskId);
	if (!task || task.orgId !== orgId) {
		throw new ConvexError('Task not found');
	}
	return task;
}

/**
 * A stageKey must name a stage of the task's own campaign — the same check
 * `documents` makes before filing evidence against one. Keys are immutable, so
 * this only ever rejects a key that never existed, never one that was renamed.
 */
/**
 * A due date is a calendar day, stored as ISO YYYY-MM-DD. Nothing else may be
 * written: the sort, the overdue check and the range filters all compare these
 * as STRINGS, which only works while every value has the same shape. A stray
 * "next tuesday" would store cleanly, then sort somewhere arbitrary and match
 * no range — wrong in three places at once, and silently.
 *
 * The shape is checked, not the calendar. Rejecting 2026-02-31 needs a date
 * library in a write path to buy very little; a wrong-but-well-formed day
 * sorts and filters correctly, which is what the readers depend on.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertDueOn(dueOn: string | undefined): void {
	if (dueOn !== undefined && dueOn !== '' && !ISO_DATE.test(dueOn)) {
		throw new ConvexError(`A due date must look like 2026-03-14, not "${dueOn}"`);
	}
}

async function assertStageKey(
	ctx: MutationCtx,
	campaignId: Id<'campaigns'>,
	stageKey: string
): Promise<void> {
	const stages = await campaignStages(ctx, campaignId);
	if (!stages.some((stage) => stage.key === stageKey)) {
		throw new ConvexError(`Invalid stage: ${stageKey}`);
	}
}

/**
 * A contact assignee has to be one of ours. A USER assignee is deliberately not
 * verified against the member list: membership changes underneath a task
 * anyway, and the spec's answer to a stale id is that the row renders
 * "Unassigned" rather than crashing — so a round trip to the auth component on
 * every write buys nothing the read path does not already handle.
 */
async function assertAssignee(
	ctx: MutationCtx,
	orgId: string,
	assignee: { kind: 'user'; userId: string } | { kind: 'contact'; contactId: Id<'contacts'> }
): Promise<void> {
	if (assignee.kind !== 'contact') return;
	const contact = await ctx.db.get('contacts', assignee.contactId);
	if (!contact || contact.orgId !== orgId) {
		throw new ConvexError('Contact not found');
	}
}

/** The project a task may name: same org, and the SAME CAMPAIGN as the task. */
async function requireTaskProjectInCampaign(
	ctx: MutationCtx,
	orgId: string,
	campaignId: Id<'campaigns'>,
	projectId: Id<'projects'>
): Promise<Doc<'projects'>> {
	const project = await requireTaskProject(ctx, orgId, projectId);
	if (project.campaignId !== campaignId) {
		throw new ConvexError('That project belongs to a different campaign');
	}
	return project;
}

/**
 * Where a new manual task sits in a project's checklist: after everything
 * already there. Campaign-level tasks get 0 — nothing orders them, the list
 * sorts by whatever the URL says, and `compareTasks` breaks the tie on label.
 */
async function nextTaskOrder(
	ctx: MutationCtx,
	projectId: Id<'projects'> | undefined
): Promise<number> {
	if (!projectId) return 0;
	const existing = await ctx.db
		.query('tasks')
		.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
		.collect();
	return existing.reduce((highest, task) => Math.max(highest, task.order), -1) + 1;
}

/**
 * Give a project the checklist items its campaign's active template defines
 * and it does not have yet. Idempotent, and safe to call again after a new
 * template version is activated — see instantiateTasks for why it only ever
 * adds.
 */
export const syncProjectTasks = mutation({
	args: { projectId: v.id('projects') },
	handler: async (ctx, args) => {
		// The campaign is only known after the project is read, so the org gate
		// comes first and the campaign-scoped one straight after.
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const project = await requireTaskProject(ctx, orgId, args.projectId);
		await requireCapability(ctx, 'projects:write', project.campaignId);

		return await instantiateTasks(ctx, project);
	}
});

/**
 * Tick or un-tick one checklist item. `completedAt` is what every task-sourced
 * stat filters on, so it is cleared as well as set — an item un-ticked by
 * mistake must not keep counting toward a date-filtered figure.
 */
export const setTaskStatus = mutation({
	args: {
		taskId: v.id('tasks'),
		status: taskStatusValidator
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');

		const task = await requireTask(ctx, orgId, args.taskId);
		const { userId } = await requireCapability(ctx, 'projects:write', task.campaignId);

		await ctx.db.patch('tasks', task._id, {
			status: args.status,
			completedAt: args.status === 'done' ? Date.now() : undefined,
			completedBy: args.status === 'done' ? userId : undefined
		});

		return task._id;
	}
});

/**
 * A task someone typed. MANUAL ONLY — a template task is born from
 * `instantiateTasks` against a checklist item, which is what lets its label and
 * tag be a snapshot of something rather than free text with a tag attached.
 *
 * `projectId` is optional: without one this is campaign-level work belonging to
 * no record, which is the case that made the column optional in the first
 * place.
 */
export const createTask = mutation({
	args: {
		campaignId: v.id('campaigns'),
		label: v.string(),
		description: v.optional(v.string()),
		assignee: v.optional(taskAssigneeValidator),
		dueOn: v.optional(v.string()),
		priority: v.optional(taskPriorityValidator),
		projectId: v.optional(v.id('projects')),
		stageKey: v.optional(v.string()),
		impactTag: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write', args.campaignId);

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			throw new ConvexError('Campaign not found');
		}

		const label = args.label.trim();
		if (!label) throw new ConvexError('A task needs a title');

		const impactTag = args.impactTag?.trim() || undefined;
		if (impactTag && !args.projectId) {
			throw new ConvexError(IMPACT_TAG_NEEDS_PROJECT);
		}

		if (args.projectId) {
			await requireTaskProjectInCampaign(ctx, orgId, args.campaignId, args.projectId);
		}
		assertDueOn(args.dueOn);
		if (args.stageKey) await assertStageKey(ctx, args.campaignId, args.stageKey);
		if (args.assignee) await assertAssignee(ctx, orgId, args.assignee);

		return await ctx.db.insert('tasks', {
			orgId,
			campaignId: args.campaignId,
			projectId: args.projectId,
			// No templateVersion and no key: this task agreed to no wording but its
			// own, and manual tasks have no natural key, so duplicates among them
			// are allowed and are the user's business.
			source: 'manual' as const,
			label,
			description: args.description?.trim() || undefined,
			order: await nextTaskOrder(ctx, args.projectId),
			impactTag,
			stageKey: args.stageKey,
			assignee: args.assignee,
			dueOn: args.dueOn,
			priority: args.priority ?? 'normal',
			status: 'todo' as const
		});
	}
});

/**
 * Edit one task. Also where a description is written — that used to be its own
 * `setTaskNote` mutation, which meant the sheet saved a task in two round trips
 * and could half-apply.
 *
 * The three snapshotted columns are refused on a template task, and only when
 * they would actually CHANGE: a sheet that submits its whole form, including
 * the read-only fields it rendered, is doing nothing wrong.
 */
export const updateTask = mutation({
	args: {
		taskId: v.id('tasks'),
		label: v.optional(v.string()),
		description: clearableString,
		assignee: clearableAssignee,
		dueOn: clearableString,
		priority: v.optional(taskPriorityValidator),
		stageKey: clearableString,
		projectId: v.optional(v.union(v.id('projects'), v.null())),
		impactTag: clearableString,
		key: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const task = await requireTask(ctx, orgId, args.taskId);
		await requireCapability(ctx, 'projects:write', task.campaignId);

		const patch: Partial<Doc<'tasks'>> = {};

		if (args.label !== undefined) {
			const label = args.label.trim();
			if (!label) throw new ConvexError('A task needs a title');
			if (label !== task.label) {
				if (task.source === 'template') throw new ConvexError(templateFieldRefusal('title'));
				patch.label = label;
			}
		}

		if (args.key !== undefined && args.key !== task.key) {
			if (task.source === 'template') throw new ConvexError(templateFieldRefusal('key'));
			patch.key = args.key || undefined;
		}

		// projectId and impactTag are decided together: the refusal is about the
		// PAIR, so moving a tagged task to campaign level has to be caught as
		// surely as tagging a campaign-level one.
		const projectId = args.projectId !== undefined ? (args.projectId ?? undefined) : task.projectId;
		let impactTag = task.impactTag;
		if (args.impactTag !== undefined) {
			const next = args.impactTag?.trim() || undefined;
			if (next !== task.impactTag) {
				if (task.source === 'template') throw new ConvexError(templateFieldRefusal('impact tag'));
				impactTag = next;
				patch.impactTag = next;
			}
		}
		if (impactTag && !projectId) {
			throw new ConvexError(IMPACT_TAG_NEEDS_PROJECT);
		}
		if (args.projectId !== undefined && projectId !== task.projectId) {
			if (projectId) {
				await requireTaskProjectInCampaign(ctx, orgId, task.campaignId, projectId);
			}
			patch.projectId = projectId;
		}

		if (args.description !== undefined) {
			patch.description = args.description?.trim() || undefined;
		}
		if (args.assignee !== undefined) {
			if (args.assignee) await assertAssignee(ctx, orgId, args.assignee);
			patch.assignee = args.assignee ?? undefined;
		}
		if (args.dueOn !== undefined) {
			assertDueOn(args.dueOn?.trim() ?? undefined);
			patch.dueOn = args.dueOn?.trim() || undefined;
		}
		if (args.priority !== undefined) {
			patch.priority = args.priority;
		}
		if (args.stageKey !== undefined) {
			const stageKey = args.stageKey?.trim() || undefined;
			if (stageKey) await assertStageKey(ctx, task.campaignId, stageKey);
			patch.stageKey = stageKey;
		}

		await ctx.db.patch('tasks', task._id, patch);
		return task._id;
	}
});

/**
 * Delete any task, template-sourced included.
 *
 * The consequence is RETURNED rather than refused. Deleting a completed tagged
 * task whose stat is published moves a number on the donor page, and the spec's
 * position is that this is the admin's call — but never a silent one. The
 * confirm asks first via `listTaskImpactWarnings`; this return is what the
 * toast afterwards says.
 */
export const deleteTask = mutation({
	args: { taskId: v.id('tasks') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const task = await requireTask(ctx, orgId, args.taskId);
		await requireCapability(ctx, 'projects:write', task.campaignId);

		// Only a COMPLETED tagged task is behind a published number; an unticked
		// one has never counted, so removing it changes nothing public.
		const campaign =
			task.status === 'done' && task.impactTag && task.projectId
				? await ctx.db.get('campaigns', task.campaignId)
				: null;
		const statLabel = campaign ? publicTaskStatLabel(campaign, task.impactTag) : null;

		await ctx.db.delete('tasks', task._id);

		return { taskId: task._id, reducedPublicStat: statLabel !== null, statLabel };
	}
});

/**
 * The four bulk actions: assign, set a due date, set a priority, mark complete.
 *
 * Every task is re-checked against its OWN campaign rather than the first one,
 * because an org-wide selection can span campaigns a team leader only partly
 * holds. The check is cached per campaign — the answer cannot differ twice for
 * the same one inside a single transaction.
 *
 * All or nothing: one refused task rolls the whole call back. A half-applied
 * bulk action leaves the user guessing which rows moved.
 */
export const bulkUpdateTasks = mutation({
	args: {
		taskIds: v.array(v.id('tasks')),
		assignee: clearableAssignee,
		dueOn: clearableString,
		priority: v.optional(taskPriorityValidator),
		status: v.optional(taskStatusValidator)
	},
	handler: async (ctx, args) => {
		const { orgId, userId } = await requireCapability(ctx, 'projects:write');

		if (
			args.assignee === undefined &&
			args.dueOn === undefined &&
			args.priority === undefined &&
			args.status === undefined
		) {
			throw new ConvexError('Nothing to change');
		}
		if (args.taskIds.length > BULK_TASK_MAX) {
			throw new ConvexError(`Select at most ${BULK_TASK_MAX} tasks at a time`);
		}
		if (args.assignee) await assertAssignee(ctx, orgId, args.assignee);

		const patch: Partial<Doc<'tasks'>> = {};
		if (args.assignee !== undefined) patch.assignee = args.assignee ?? undefined;
		if (args.dueOn !== undefined) {
			assertDueOn(args.dueOn?.trim() ?? undefined);
			patch.dueOn = args.dueOn?.trim() || undefined;
		}
		if (args.priority !== undefined) patch.priority = args.priority;
		if (args.status !== undefined) {
			patch.status = args.status;
			// Same contract as setTaskStatus: cleared as well as set, so an
			// un-ticked row stops counting toward a date-filtered figure.
			patch.completedAt = args.status === 'done' ? Date.now() : undefined;
			patch.completedBy = args.status === 'done' ? userId : undefined;
		}

		const checked = new Set<string>();
		for (const taskId of args.taskIds) {
			const task = await requireTask(ctx, orgId, taskId);
			if (!checked.has(task.campaignId as string)) {
				await requireCapability(ctx, 'projects:write', task.campaignId);
				checked.add(task.campaignId as string);
			}
			await ctx.db.patch('tasks', task._id, patch);
		}

		return args.taskIds.length;
	}
});

// ------------------------------------------------------------------
// Saved views
// ------------------------------------------------------------------

/**
 * A view the caller may write. Their own always; a SHARED one also to anyone
 * holding `settings:manage`, because a shared view outlives the person who
 * published it and an org needs to be able to take it down.
 */
async function requireWritableTaskView(
	ctx: MutationCtx,
	taskViewId: Id<'taskViews'>
): Promise<{ view: Doc<'taskViews'>; orgId: string; userId: string }> {
	const { orgId, userId, access } = await requireCapability(ctx, 'projects:read');
	const view = await ctx.db.get('taskViews', taskViewId);
	if (!view || view.orgId !== orgId) {
		throw new ConvexError('View not found');
	}
	if (view.ownerUserId !== userId && !(view.isShared && can(access, 'settings:manage'))) {
		throw new ConvexError('Not permitted: this view belongs to someone else');
	}
	return { view, orgId, userId };
}

/** Publishing a view to the whole org is a settings decision, not a list one. */
async function assertMaySetShared(ctx: MutationCtx, isShared: boolean): Promise<void> {
	if (!isShared) return;
	await requireCapability(ctx, 'settings:manage');
}

/**
 * Save the current filters as a view. `query` is the URL query string, stored
 * VERBATIM — a view is literally "the URL I had", so there is no parallel
 * filter schema here to drift from the parser, and a view is a shareable link.
 */
export const saveTaskView = mutation({
	args: {
		name: v.string(),
		query: v.string(),
		isShared: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const { orgId, userId } = await requireCapability(ctx, 'projects:read');

		const name = args.name.trim();
		if (!name) throw new ConvexError('A view needs a name');

		const isShared = args.isShared ?? false;
		await assertMaySetShared(ctx, isShared);

		const own = await ctx.db
			.query('taskViews')
			.withIndex('by_orgId_and_ownerUserId', (q) => q.eq('orgId', orgId).eq('ownerUserId', userId))
			.take(TASK_VIEW_MAX);

		return await ctx.db.insert('taskViews', {
			orgId,
			ownerUserId: userId,
			name,
			isShared,
			// Stored with the leading '?' already stripped, matching what
			// serializeTaskFilters produces and what URLSearchParams accepts back.
			query: args.query.replace(/^\?/, ''),
			order: own.reduce((highest, view) => Math.max(highest, view.order), -1) + 1
		});
	}
});

/**
 * Point an existing view at different filters — "update this view to what I am
 * looking at now". Name, sharing and order ride along because the same edit
 * dialog owns all four and a mutation is a transaction.
 */
export const setTaskViewQuery = mutation({
	args: {
		taskViewId: v.id('taskViews'),
		query: v.optional(v.string()),
		name: v.optional(v.string()),
		isShared: v.optional(v.boolean()),
		order: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { view } = await requireWritableTaskView(ctx, args.taskViewId);

		const patch: Partial<Doc<'taskViews'>> = {};
		if (args.query !== undefined) patch.query = args.query.replace(/^\?/, '');
		if (args.name !== undefined) {
			const name = args.name.trim();
			if (!name) throw new ConvexError('A view needs a name');
			patch.name = name;
		}
		if (args.isShared !== undefined && args.isShared !== view.isShared) {
			await assertMaySetShared(ctx, args.isShared);
			patch.isShared = args.isShared;
		}
		if (args.order !== undefined) patch.order = args.order;

		await ctx.db.patch('taskViews', view._id, patch);
		return view._id;
	}
});

export const deleteTaskView = mutation({
	args: { taskViewId: v.id('taskViews') },
	handler: async (ctx, args) => {
		const { view } = await requireWritableTaskView(ctx, args.taskViewId);
		await ctx.db.delete('taskViews', view._id);
		return null;
	}
});
