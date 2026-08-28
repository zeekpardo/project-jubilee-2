// ============================================================
// Authoring a workflow
// ============================================================
// THE DRAFT IS EDITABLE AND THE VERSION IS NOT, and that split is the whole
// design. Every versioned table beside this one — costTemplates, taskTemplates,
// promptVersions — froze AUTHORING: there was no edit and no delete, so a
// configuration nobody had ever run still could not be corrected. That rule was
// protecting something real, but at the wrong altitude. What must not change is
// a version a RUN NAMES, because the log is also the replay set
// (PLAN-ai-checkin.md §5) and a replay against a moved goalpost proves nothing.
// A draft nobody has run protects nothing by being immutable.
//
// So: `updateWorkflow` patches the draft freely. `publishWorkflow` snapshots it
// into a `workflowVersions` row that is never patched again. Runs bind to the
// snapshot. Editing after publishing changes what the NEXT run asks, never what
// a family is halfway through answering.
//
// WHICH CAPABILITY. `settings:manage`, matching what prompts used to require
// rather than what campaign config requires. A workflow carries the words a
// machine says to a freed family on the charity's behalf, and the previous code
// was explicit that this is an org-level decision rather than a per-campaign
// one. Scoping it to `campaign:edit` because the row now has a campaignId would
// widen that from owner/admin to every campaign lead as a side effect of a
// refactor, which is not a decision a refactor gets to make.
// ============================================================

import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { requireCapability } from '../model/access';
import { promptsInput, reportInput, stepInput, triggerInput } from './shapes';
import { DRAFTER_V1, JUDGE_V1, RESPONDER_V2 } from '../../lib/domain/checkin-prompts';
import { SHIPPED_REPORT, shippedWorkflowSteps } from '../../lib/domain/workflows';

/**
 * A key has to survive being a tool-schema property name and an objective key
 * in a judge prompt, so it is constrained to what is safe in both.
 */
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,48}$/;

function assertKeys(keys: string[], what: string): void {
	const seen = new Set<string>();
	for (const key of keys) {
		if (!KEY_PATTERN.test(key)) {
			throw new ConvexError(
				`${what} key "${key}" must be lowercase letters, digits and underscores, starting with a letter.`
			);
		}
		if (seen.has(key)) {
			// Two objectives with one key collide in `bestStates`, which is keyed by
			// it — the second would silently overwrite the first's state.
			throw new ConvexError(`Duplicate ${what} key: ${key}`);
		}
		seen.add(key);
	}
}

/** Everything publish refuses to freeze. Run on publish, not on every keystroke. */
function assertPublishable(input: {
	steps: Array<{ key: string; objectives: Array<{ key: string }> }>;
	report: { sections: Array<{ key: string }> };
}): void {
	assertKeys(
		input.steps.map((step) => step.key),
		'Step'
	);
	assertKeys(
		input.steps.flatMap((step) => step.objectives.map((objective) => objective.key)),
		'Objective'
	);
	assertKeys(
		input.report.sections.map((section) => section.key),
		'Section'
	);

	if (input.steps.every((step) => step.objectives.length === 0)) {
		// An empty objective set reads to `decideNext` as "everything answered",
		// so the engine would draft from a conversation that never happened.
		throw new ConvexError('A workflow needs at least one objective.');
	}
	if (input.report.sections.length === 0) {
		// Every section is a required property on the generated tool. Zero
		// sections is a tool that asks for a title and nothing else.
		throw new ConvexError('A report needs at least one section.');
	}
	if (input.report.sections.some((section) => section.key === 'title')) {
		// `title` is the tool's own property; a section by that name would
		// overwrite it in the generated schema.
		throw new ConvexError('A section cannot be called "title".');
	}
}

async function loadOwned(ctx: MutationCtx, orgId: string, workflowId: Id<'workflows'>) {
	const workflow = await ctx.db.get('workflows', workflowId);
	if (!workflow || workflow.orgId !== orgId) throw new ConvexError('Workflow not found');
	return workflow;
}

/**
 * A new draft, pre-filled with everything this build ships.
 *
 * Seeded rather than empty because a workflow with three blank prompts is not
 * an author's starting point, it is a form. The shipped wording is the thing
 * that has been thought about hardest in this feature; an author should be
 * editing it, not recreating it.
 */
export const createWorkflow = mutation({
	args: { campaignId: v.id('campaigns'), name: v.string() },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) throw new ConvexError('Campaign not found');

		return await ctx.db.insert('workflows', {
			orgId,
			campaignId: args.campaignId,
			name: args.name.trim() || 'Untitled workflow',
			trigger: { kind: 'manual' as const },
			steps: shippedWorkflowSteps(),
			report: {
				titleGuidance: SHIPPED_REPORT.titleGuidance,
				instructions: SHIPPED_REPORT.instructions,
				sections: SHIPPED_REPORT.sections
			},
			prompts: {
				responder: { content: RESPONDER_V2.content, model: 'claude-opus-5' },
				judge: { content: JUDGE_V1.content, model: 'claude-haiku-4-5-20251001' },
				drafter: { content: DRAFTER_V1.content, model: 'claude-opus-5' }
			},
			status: 'draft' as const
		});
	}
});

/**
 * Patch the draft. Every field optional, because the editor saves one tab at a
 * time and a partial save must not blank the others.
 *
 * Deliberately NOT validated the way publish is. An author mid-edit has an
 * empty section and a half-typed key constantly, and refusing to save that
 * would mean losing work to a rule that only matters at the moment somebody
 * puts words in front of a family.
 */
export const updateWorkflow = mutation({
	args: {
		workflowId: v.id('workflows'),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
		trigger: v.optional(triggerInput),
		steps: v.optional(v.array(stepInput)),
		report: v.optional(reportInput),
		prompts: v.optional(promptsInput)
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');
		const workflow = await loadOwned(ctx, orgId, args.workflowId);

		if (workflow.status === 'archived') {
			// Archived exists so runs stay replayable, not as a recycle bin. An
			// edit here would be an edit nobody could publish.
			throw new ConvexError('This workflow is archived. Restore it before editing.');
		}

		const { workflowId, ...fields } = args;
		const patch = Object.fromEntries(
			Object.entries(fields).filter(([, value]) => value !== undefined)
		);
		if (Object.keys(patch).length === 0) return workflowId;

		await ctx.db.patch('workflows', workflowId, patch);
		return workflowId;
	}
});

/**
 * Freeze the draft as the next version, and point new runs at it.
 *
 * Runs already open keep the version they bound to at open — they name it on
 * their own row and nothing here reaches back through this table to find it. A
 * family does not get different questions mid-conversation because an admin
 * published while they were typing.
 */
export const publishWorkflow = mutation({
	args: { workflowId: v.id('workflows') },
	handler: async (ctx, args) => {
		const { orgId, userId } = await requireCapability(ctx, 'settings:manage');
		const workflow = await loadOwned(ctx, orgId, args.workflowId);

		assertPublishable({ steps: workflow.steps, report: workflow.report });

		const previous = await ctx.db
			.query('workflowVersions')
			.withIndex('by_workflowId_and_version', (q) => q.eq('workflowId', workflow._id))
			.order('desc')
			.first();
		const version = (previous?.version ?? 0) + 1;

		const versionId = await ctx.db.insert('workflowVersions', {
			orgId,
			workflowId: workflow._id,
			campaignId: workflow.campaignId,
			version,
			publishedAt: Date.now(),
			publishedByUserId: userId,
			name: workflow.name,
			trigger: workflow.trigger,
			steps: workflow.steps,
			report: workflow.report,
			prompts: workflow.prompts
		});

		await ctx.db.patch('workflows', workflow._id, {
			status: 'published' as const,
			currentVersionId: versionId
		});

		return version;
	}
});

/**
 * Hide a workflow without destroying what its runs point at.
 *
 * The published counterpart of delete. Every `workflowVersions` row survives,
 * because a run naming one is still readable and still replayable — the same
 * trade `deleteConversationCascade` makes when it keeps a draft update after
 * the conversation behind it goes.
 */
export const archiveWorkflow = mutation({
	args: { workflowId: v.id('workflows') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');
		const workflow = await loadOwned(ctx, orgId, args.workflowId);

		await ctx.db.patch('workflows', workflow._id, {
			status: 'archived' as const,
			// Cleared so nothing new binds to it. The version row itself stays.
			currentVersionId: undefined
		});
		return workflow._id;
	}
});

/**
 * Bring an archived workflow back as a draft.
 *
 * Archive has to be reversible or it is a trap: `updateWorkflow` refuses to
 * patch an archived row and tells the caller to restore it, and a refusal that
 * names an action nobody can take is worse than no refusal at all.
 *
 * It comes back as `draft`, not as `published`, even though its versions still
 * exist. Un-archiving is a decision to work on something again; deciding it
 * should be running is the separate one that Publish already is.
 */
export const restoreWorkflow = mutation({
	args: { workflowId: v.id('workflows') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');
		const workflow = await loadOwned(ctx, orgId, args.workflowId);

		if (workflow.status !== 'archived') return workflow._id;

		await ctx.db.patch('workflows', workflow._id, { status: 'draft' as const });
		return workflow._id;
	}
});

/**
 * Delete a workflow that has never been published.
 *
 * Refuses once a version exists, and the refusal names archive. A published
 * version may be the provenance of a post somebody published about a real
 * family, and deleting it would leave that post's decision trace pointing at
 * nothing.
 */
export const deleteWorkflow = mutation({
	args: { workflowId: v.id('workflows') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');
		const workflow = await loadOwned(ctx, orgId, args.workflowId);

		const published = await ctx.db
			.query('workflowVersions')
			.withIndex('by_workflowId', (q) => q.eq('workflowId', workflow._id))
			.first();
		if (published) {
			throw new ConvexError(
				'This workflow has published versions that runs may name. Archive it instead.'
			);
		}

		await ctx.db.delete('workflows', workflow._id);
		return null;
	}
});
