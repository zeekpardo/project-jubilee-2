// Instantiating a project's checklist from its campaign's active task
// template, and keeping it in step as the template moves on.
//
// A task is a SNAPSHOT of the template item it came from: label and impactTag
// are copied onto the row, and the version it was created against is recorded.
// Same contract as `budgets` snapshotting a costTemplates version — rewording a
// checklist item must not rewrite what a completed task meant when it was
// ticked.
//
// Whether the tag's count is PUBLISHED is not snapshotted: that lives on the
// campaign's publicStats row and is read live, so flipping a stat public
// includes ticks recorded before the switch was flipped.

import { ConvexError } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';

export type TaskTemplateItem = Doc<'taskTemplates'>['items'][number];

/** The campaign's active checklist version, or null when it has none. */
export async function activeTaskTemplate(
	ctx: QueryCtx,
	campaignId: Id<'campaigns'>
): Promise<Doc<'taskTemplates'> | null> {
	return await ctx.db
		.query('taskTemplates')
		.withIndex('by_campaignId_and_isActive', (q) =>
			q.eq('campaignId', campaignId).eq('isActive', true)
		)
		.unique();
}

/** A project in the caller's org, or a hard failure. */
export async function requireTaskProject(
	ctx: MutationCtx,
	orgId: string,
	projectId: Id<'projects'>
): Promise<Doc<'projects'>> {
	const project = await ctx.db.get('projects', projectId);
	if (!project || project.orgId !== orgId) {
		throw new ConvexError('Project not found');
	}
	return project;
}

/**
 * Create any of the active template's items this project does not have yet,
 * and return how many were added.
 *
 * ADDITIVE ONLY. An item dropped from a newer template version leaves the
 * already-created task alone: it may be ticked, and deleting it would erase
 * work that actually happened. Nor is an existing task re-snapshotted from the
 * newer wording — that is the whole point of snapshotting. So syncing twice, or
 * after a new version is activated, only ever fills in what is missing.
 */
export async function instantiateTasks(
	ctx: MutationCtx,
	project: Doc<'projects'>
): Promise<number> {
	const template = await activeTaskTemplate(ctx, project.campaignId);
	if (!template) {
		throw new ConvexError('This campaign has no active task template');
	}

	const existing = await ctx.db
		.query('tasks')
		.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
		.collect();
	// Manual tasks on the same project carry no key, so they contribute
	// `undefined` here and can never collide with a template item.
	const have = new Set(existing.map((task) => task.key));

	let created = 0;
	for (const item of template.items) {
		if (have.has(item.key)) continue;
		await ctx.db.insert('tasks', {
			orgId: project.orgId,
			projectId: project._id,
			campaignId: project.campaignId,
			// The discriminator, and what makes templateVersion/key/label
			// read-only downstream: these came from the checklist, so editing them
			// per-record would make records disagree about the same step.
			source: 'template' as const,
			templateVersion: template.version,
			key: item.key,
			label: item.label,
			order: item.order,
			// A checklist item is ordinary work until someone says otherwise.
			// Urgency belongs to the situation, not to the template.
			priority: 'normal' as const,
			// Absent stays absent: an untagged item feeds no stat, and writing an
			// empty string would put it in the by_campaignId_and_impactTag index
			// under a tag nothing looks for.
			...(item.impactTag ? { impactTag: item.impactTag } : {}),
			status: 'todo' as const
		});
		created++;
	}

	return created;
}

/** Every task row for a project, in checklist order. */
export async function listProjectTasks(
	ctx: QueryCtx,
	projectId: Id<'projects'>
): Promise<Doc<'tasks'>[]> {
	const tasks = await ctx.db
		.query('tasks')
		.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
		.collect();
	// Tie-break on key so a project's checklist has one stable order. Manual
	// tasks have none, and sort ahead of template items sharing their `order`.
	return tasks.sort((a, b) => a.order - b.order || (a.key ?? '').localeCompare(b.key ?? ''));
}
