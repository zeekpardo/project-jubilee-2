// Row types are DERIVED from the query return types and the document shapes,
// never hand-written — the same contract features/checkins/types.ts keeps. A
// field renamed server-side surfaces as a type error here instead of silently
// rendering blank, and the draft below is built out of the DOCUMENT's own
// member types rather than the domain interfaces so that what this editor
// produces is, by construction, what `updateWorkflow` accepts.

import type { FunctionReturnType } from 'convex/server';
import type { api } from '$convex/_generated/api';
import type { Doc } from '$convex/_generated/dataModel';

export type WorkflowRow = Doc<'workflows'>;
export type WorkflowVersionRow = Doc<'workflowVersions'>;

/** Null when the viewer may not read it, or it is gone. */
export type WorkflowDetail = NonNullable<
	FunctionReturnType<typeof api.workflows.queries.getWorkflow>
>;

export type CampaignOption = FunctionReturnType<typeof api.campaigns.queries.listCampaigns>[number];
export type StageOption = FunctionReturnType<typeof api.pipelineStages.queries.listStages>[number];
export type FieldOption = FunctionReturnType<
	typeof api.customFields.queries.listFieldDefinitions
>[number];

export type WorkflowStatus = WorkflowRow['status'];
export type WorkflowTrigger = WorkflowRow['trigger'];
export type WorkflowTriggerKind = WorkflowTrigger['kind'];
export type WorkflowStep = WorkflowRow['steps'][number];
export type WorkflowObjective = WorkflowStep['objectives'][number];
export type WorkflowCapture = NonNullable<WorkflowObjective['capture']>;
export type WorkflowReport = WorkflowRow['report'];
export type WorkflowSection = WorkflowReport['sections'][number];
export type WorkflowPrompts = WorkflowRow['prompts'];
export type PromptRole = keyof WorkflowPrompts;

/**
 * The whole workflow under edit, held as ONE object.
 *
 * One object rather than a field per tab because the tab panels unmount as you
 * move between them: anything held inside a tab would be gone the moment
 * someone clicked "Report" to check a section wording and came back. This
 * lives on the page, above `Tabs.Root`, and the tabs mutate it in place.
 */
export interface WorkflowDraft {
	name: string;
	description: string;
	trigger: WorkflowTrigger;
	steps: WorkflowStep[];
	report: WorkflowReport;
	prompts: WorkflowPrompts;
}

/**
 * Copy a saved workflow into an editable draft.
 *
 * A DEEP copy via structuredClone, not a spread. The row arrives from a live
 * Convex subscription and is shared with every other reader of that query;
 * mutating `workflow.steps[0].objectives` in place would edit the cache under
 * the list page. The clone is also what makes the dirty check meaningful — the
 * saved baseline has to be a value nobody else can move.
 */
export function toDraft(workflow: WorkflowDetail['workflow']): WorkflowDraft {
	return structuredClone({
		name: workflow.name,
		description: workflow.description ?? '',
		trigger: workflow.trigger,
		steps: workflow.steps,
		report: workflow.report,
		prompts: workflow.prompts
	});
}

/**
 * A blank input read as "use the default", never as zero.
 *
 * `minRating` absent means RATING_ANSWERED; `minRating` 0 means every answer
 * passes. They are opposite instructions and an empty box must not silently
 * pick the second one, so the parse returns `undefined` for blank and for
 * anything that is not a finite number.
 */
export function optionalNumber(raw: string): number | undefined {
	const trimmed = raw.trim();
	if (trimmed === '') return undefined;
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** The inverse, for rendering a `number | undefined` back into an input. */
export function numberText(value: number | undefined): string {
	return value === undefined ? '' : String(value);
}

export function blankStep(index: number): WorkflowStep {
	return { key: `step_${index + 1}`, title: '', entryMessage: '', objectives: [] };
}

export function blankObjective(): WorkflowObjective {
	return { key: '', label: '', description: '' };
}

export function blankSection(): WorkflowSection {
	return { key: '', label: '', guidance: '' };
}

/** What the "When answered" select offers, flattened so one select drives it. */
export type CaptureChoice = 'none' | 'project' | 'contact';

export function captureChoice(capture: WorkflowCapture | undefined): CaptureChoice {
	if (!capture || capture.kind === 'none') return 'none';
	return capture.entity;
}

/**
 * Move an objective's capture target to a new choice.
 *
 * Switching entity CLEARS the field key rather than carrying it across: a key
 * is only meaningful against the entity it was defined on, and a stale
 * `household_size` pointing at a contact is a write that would be refused at
 * run time for a reason nobody could see in this form.
 */
export function withCaptureChoice(
	objective: WorkflowObjective,
	choice: CaptureChoice
): WorkflowCapture | undefined {
	if (choice === 'none') return undefined;
	const current = objective.capture;
	if (current && current.kind === 'field' && current.entity === choice) return current;
	return { kind: 'field', entity: choice, fieldKey: '' };
}

/**
 * The arguments `updateWorkflow` takes, built from the draft.
 *
 * Optional strings inside the nested shapes are dropped rather than sent
 * empty — a blank `entryMessage` is not "the empty lead-in", it is no lead-in,
 * and storing `''` would hand the responder a line of nothing to work guidance
 * out of.
 *
 * `description` is the exception and is always sent, blank included. The
 * mutation patches only the arguments that are not `undefined`, so omitting it
 * would mean a description could be written and never cleared.
 */
export function toUpdateArgs(draft: WorkflowDraft): {
	name: string;
	description: string;
	trigger: WorkflowTrigger;
	steps: WorkflowStep[];
	report: WorkflowReport;
	prompts: WorkflowPrompts;
} {
	return {
		name: draft.name.trim(),
		description: draft.description.trim(),
		trigger: draft.trigger,
		steps: draft.steps.map((step) => ({
			key: step.key.trim(),
			title: step.title.trim(),
			entryMessage: step.entryMessage?.trim() || undefined,
			objectives: step.objectives.map((objective) => ({
				key: objective.key.trim(),
				label: objective.label.trim(),
				description: objective.description.trim(),
				minRating: objective.minRating,
				minConfidence: objective.minConfidence,
				maxAttempts: objective.maxAttempts,
				// Absent rather than `{ kind: 'none' }`: `captureValueFor` reads the
				// two identically and the domain calls absent the default, so a
				// stored objective does not carry a decision nobody made.
				capture:
					objective.capture && objective.capture.kind === 'field' ? objective.capture : undefined,
				// Same rule for the two gates: an empty list is not a rule that
				// always passes, it is no rule.
				requires:
					objective.requires && objective.requires.length > 0 ? objective.requires : undefined,
				skipIfKnown: objective.skipIfKnown ? true : undefined
			}))
		})),
		report: {
			titleGuidance: draft.report.titleGuidance.trim(),
			instructions: draft.report.instructions.trim(),
			sections: draft.report.sections.map((section) => ({
				key: section.key.trim(),
				label: section.label.trim(),
				guidance: section.guidance.trim(),
				approxWords: section.approxWords
			}))
		},
		prompts: {
			// Content is NOT trimmed. It is the literal text a model receives and
			// its leading and trailing whitespace is part of the wording.
			responder: {
				content: draft.prompts.responder.content,
				model: draft.prompts.responder.model.trim()
			},
			judge: { content: draft.prompts.judge.content, model: draft.prompts.judge.model.trim() },
			drafter: {
				content: draft.prompts.drafter.content,
				model: draft.prompts.drafter.model.trim()
			}
		}
	};
}

/**
 * The same shape `assertKeys` enforces server-side. Duplicated here ON PURPOSE
 * and not exported as a lone regex: a key has to survive being a tool-schema
 * property name and an objective key inside a judge prompt, and the editor
 * should say so while someone is typing rather than after they press Publish.
 */
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,48}$/;

export type PublishProblem =
	| 'key'
	| 'duplicate'
	| 'noObjectives'
	| 'noSections'
	| 'reservedSection';

/**
 * Why publish would be refused, or null.
 *
 * A MIRROR of `assertPublishable`, not a second opinion: every branch here
 * exists server-side too and the server is the one that decides. What this
 * buys is that the button says why it is disabled instead of the author
 * finding out from a toast. Saving is deliberately NOT gated on any of it —
 * the draft is editable precisely so half-finished work can be put down.
 */
export function publishProblem(draft: WorkflowDraft): PublishProblem | null {
	const stepKeys = draft.steps.map((step) => step.key.trim());
	const objectiveKeys = draft.steps.flatMap((step) =>
		step.objectives.map((objective) => objective.key.trim())
	);
	const sectionKeys = draft.report.sections.map((section) => section.key.trim());

	for (const key of [...stepKeys, ...objectiveKeys, ...sectionKeys]) {
		if (!KEY_PATTERN.test(key)) return 'key';
	}
	for (const keys of [stepKeys, objectiveKeys, sectionKeys]) {
		if (new Set(keys).size !== keys.length) return 'duplicate';
	}

	// An empty objective set reads to `decideNext` as "everything answered", so
	// the engine would draft from a conversation that never happened.
	if (objectiveKeys.length === 0) return 'noObjectives';
	// Every section is a required property on the generated tool. Zero sections
	// is a tool that asks for a title and nothing else.
	if (sectionKeys.length === 0) return 'noSections';
	// `title` is the tool's own property; a section by that name would overwrite
	// it in the generated schema.
	if (sectionKeys.includes('title')) return 'reservedSection';

	return null;
}
