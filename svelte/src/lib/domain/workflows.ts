// ============================================================
// What a workflow asks, and what shape its report comes back in
// ============================================================
// checkin-objectives.ts answers "what is an objective and when is it met".
// This file answers the two questions above it, both of which used to be
// answered by constants in this repo and are now authored by the org:
//
//   A TEMPLATE  — the ordered steps a check-in works through, and for each
//                 objective whether its answer is merely read by a human or
//                 written onto the record.
//   A FORMAT    — the sections the drafted update is made of, which become the
//                 `draft_update` tool's input_schema.
//
// WHY A FORMAT IS A SCHEMA AND NOT AN INSTRUCTION. §3.4 makes "nothing
// publishes without a human" true by never handing the model a publish tool,
// rather than by asking it not to publish. The same move applies here: an
// author who says "this update has three sections" gets a tool whose schema
// has three required properties, not a paragraph asking for three sections.
// A prompt instruction is probabilistic; the shape of a function call is not.
//
// STEPS, NOT A GRAPH. Steps are ordered and every step runs. There are no
// edges, no branches and no conditions — the only thing that removes an
// objective is `skipIfKnown`, and the only thing that stops one being asked
// again is `maxAttempts`. Branching is a real feature and this is deliberately
// not it: the engine's control structure is "which objectives are outstanding"
// (§3.1), and a graph would be a second control structure competing with it.
//
// Pure — no db, no framework, no network — like every other lib/domain module,
// so the resolver and the schema generator are exercisable in a test file with
// no deployment and no API key.
// ============================================================

import { DEFAULT_CHECKIN_OBJECTIVES, type CheckinObjective } from './checkin-objectives';

// ============================================================
// Template
// ============================================================

/**
 * The household facts an objective may gate on.
 *
 * A CLOSED list, deliberately. These are read off the record by the caller —
 * see `familyChildFacts` — and every one of them costs a query, so a workflow
 * author picking from four checkboxes is the whole feature. An open expression
 * language over custom fields is a different, larger thing, and `skipIfKnown`
 * already covers the case it would mostly be used for.
 */
export type HouseholdFact = 'hasChildren' | 'hasSchoolAgeChildren';

export const HOUSEHOLD_FACTS: HouseholdFact[] = ['hasChildren', 'hasSchoolAgeChildren'];

/** What the record can tell us, resolved once per run. */
export type HouseholdFacts = Record<HouseholdFact, boolean>;

/**
 * One objective as an author writes it, before it is resolved against a
 * particular family.
 *
 * Everything a resolved `CheckinObjective` carries, plus the two things that
 * only mean something at resolve time and are therefore NOT snapshotted onto
 * the conversation: `skipIfKnown` has already been applied by the time the set
 * is frozen, so keeping it would preserve a decision as though it were still
 * pending.
 */
export interface TemplateObjective extends CheckinObjective {
	/**
	 * Household facts that must hold before this objective is asked at all.
	 *
	 * The general form of a rule that used to be two hardcoded keys in
	 * `defaultObjectivesForFamily`, and it is NOT the same mechanism as
	 * `skipIfKnown`: that one asks whether a captured FIELD already holds the
	 * answer, this one asks whether the question applies to this household in
	 * the first place. Collapsing them would mean a family with no children
	 * gets asked how their children are the moment nobody has filled in a
	 * custom field — which is exactly the failure the original rule existed to
	 * prevent, and the reason it is worth carrying across as data rather than
	 * quietly dropping with the code path that held it.
	 *
	 * Empty or absent means the objective always applies.
	 */
	requires?: HouseholdFact[];

	/**
	 * Do not ask when the record already holds a value for this objective's
	 * capture target.
	 *
	 * Only meaningful with `capture.kind === 'field'` — there is nothing to
	 * check against for an objective that files nothing, so it is ignored
	 * there rather than treated as false.
	 *
	 * This is the general form of the rule the shipped default used to hardcode
	 * as `hasChildren` / `hasSchoolAgeChildren`: do not ask a family something
	 * we were already told.
	 */
	skipIfKnown?: boolean;
}

/**
 * A named group of objectives.
 *
 * A step is a UNIT OF AUTHORING, not a unit of execution: the engine flattens
 * every step into one outstanding set and the responder picks its own order
 * within it (§3.1 — "in whatever order the conversation makes natural"). What
 * a step buys is that an author can say "these four are the school questions"
 * and give them one lead-in line, without the engine marching a family through
 * a form.
 */
export interface CheckinStep {
	key: string;
	title: string;
	/**
	 * Optional context handed to the responder while any objective in this step
	 * is outstanding. Guidance, never a script — the responder writes the actual
	 * words, because a verbatim line is how a warm message becomes a form.
	 */
	entryMessage?: string;
	objectives: TemplateObjective[];
}

/**
 * The whole authored set, frozen as a version.
 *
 * Steps and objectives are inline rather than child tables for the same reason
 * `taskTemplates.items` and `checkinConversations.objectives` are: bounded at a
 * handful, always read whole, and meaningless apart from their parent.
 */
export interface CheckinTemplate {
	version: string;
	name: string;
	steps: CheckinStep[];
}

/** Every objective in the template, in step order then objective order. */
export function templateObjectives(template: CheckinTemplate): TemplateObjective[] {
	return template.steps.flatMap((step) => step.objectives);
}

/**
 * The objective set for one conversation.
 *
 * `knownKeys` is the set of objective keys the record can already answer,
 * computed by the caller — the DB knows which custom field holds which value
 * and this module deliberately does not. Passing keys rather than a record is
 * what keeps this function pure and what keeps "what may be read off a family"
 * in one place on the Convex side.
 *
 * The returned objectives are the SNAPSHOT: what gets frozen onto the
 * conversation and what the judge is scored against for the rest of its life.
 * `skipIfKnown` is dropped on the way out because it has already been spent.
 */
export function resolveObjectives(
	template: CheckinTemplate,
	input: { knownKeys: ReadonlySet<string>; facts: HouseholdFacts }
): CheckinObjective[] {
	const resolved: CheckinObjective[] = [];

	for (const objective of templateObjectives(template)) {
		// Applicability first. An objective that does not apply to this household
		// is not asked, whatever any captured field says — a family with no
		// children has nothing to tell us about their children, and a stored
		// value would be the thing that was wrong, not the answer.
		if (objective.requires?.some((fact) => !input.facts[fact])) continue;

		const capturesField = objective.capture?.kind === 'field';
		if (objective.skipIfKnown && capturesField && input.knownKeys.has(objective.key)) continue;

		// Both gates are spent by the time the set is frozen, so neither rides
		// onto the snapshot: keeping them would preserve a decision already made
		// as though it were still pending.
		const { skipIfKnown: _skipIfKnown, requires: _requires, ...snapshot } = objective;
		resolved.push(snapshot);
	}

	return resolved;
}

/**
 * Whether a judged answer may be written to the record.
 *
 * Two gates, and both matter. The state gate is the same bar everything else
 * in this engine uses: a `needs_review` reading is one we do not trust, and
 * editing a family's record off a reading we do not trust is exactly the write
 * a person should be making instead. The options gate is what makes a picklist
 * a picklist — a value outside the list is not "close enough", it is a value
 * the field does not have.
 */
export function captureValueFor(
	objective: CheckinObjective,
	input: { state: 'unanswered' | 'needs_review' | 'answered'; answer: string | null }
): { entity: 'project' | 'contact'; fieldKey: string; value: string } | null {
	const capture = objective.capture;
	if (!capture || capture.kind !== 'field') return null;
	if (input.state !== 'answered') return null;

	const value = input.answer?.trim();
	if (!value) return null;

	if (capture.options && capture.options.length > 0) {
		const match = capture.options.find((option) => option.toLowerCase() === value.toLowerCase());
		if (!match) return null;
		return { entity: capture.entity, fieldKey: capture.fieldKey, value: match };
	}

	return { entity: capture.entity, fieldKey: capture.fieldKey, value };
}

// ============================================================
// Format
// ============================================================

/** One part of a drafted update. Becomes one property on `draft_update`. */
export interface UpdateSection {
	/** Property name on the tool schema. Lowercase snake_case. */
	key: string;
	/** Heading in the assembled markdown, and the author-facing name. */
	label: string;
	/** What belongs in this section. Handed to the model as the property's description. */
	guidance: string;
	/** Rough target, folded into the description. Absent = no steer. */
	approxWords?: number;
}

/**
 * What a drafted update looks like, frozen as a version.
 *
 * Separate from the drafter PROMPT rather than folded into it, and the split is
 * the point: the prompt is the drafter's job and ethics — what it may say about
 * a family, what it must not invent — and changes rarely and carefully. The
 * format is the house style of the newsletter, and an author should be able to
 * add a section without touching a prompt whose wording protects people.
 */
export interface UpdateFormat {
	// No `version` and no `name` of its own. The report is part of a workflow
	// version, so the version it belongs to is the only version it has — a
	// second one could only ever disagree with the first.
	/** Replaces the shipped "At most eight words." */
	titleGuidance: string;
	/** Tone and house rules that are not structural. Appended to the drafter's input. */
	instructions: string;
	sections: UpdateSection[];
}

/**
 * A tool definition in the shape the Messages API takes.
 *
 * Redeclared here rather than imported from checkin-prompts.ts to keep the
 * dependency pointing one way: prompts already import objectives, and having
 * prompts import this file while this file imported prompts would be a cycle.
 */
export interface GeneratedTool {
	name: string;
	description: string;
	input_schema: {
		type: 'object';
		properties: Record<string, unknown>;
		required: string[];
		additionalProperties: false;
	};
}

/**
 * Build the `draft_update` tool for one format.
 *
 * Every section is REQUIRED. An optional section is a section the model will
 * sometimes omit, and a reviewer reading a draft has no way to tell an omitted
 * section from one the conversation had nothing to fill it with — so a format
 * that wants a section to be skippable should say so in that section's
 * guidance and let the model write "nothing to report", which is a fact rather
 * than an absence.
 *
 * The name is fixed. `responderTools` asserts against a forbidden list by name,
 * and a generated name would let an author route around that check.
 */
export function draftUpdateToolFor(format: UpdateFormat): GeneratedTool {
	const properties: Record<string, unknown> = {
		title: { type: 'string', description: format.titleGuidance }
	};

	for (const section of format.sections) {
		properties[section.key] = {
			type: 'string',
			description: section.approxWords
				? `${section.guidance} Around ${section.approxWords} words.`
				: section.guidance
		};
	}

	return {
		name: 'draft_update',
		description:
			'Save a draft blog update about this check-in for a member of staff to review. The draft is not published and is not visible to anyone outside the organization.',
		input_schema: {
			type: 'object',
			properties,
			required: ['title', ...format.sections.map((section) => section.key)],
			additionalProperties: false
		}
	};
}

/**
 * Fold the model's per-section strings into the single markdown body that
 * `updates.body` stores.
 *
 * A ONE-SECTION FORMAT PRODUCES NO HEADING. That is what keeps the shipped
 * default byte-identical to what this engine produced before formats existed —
 * a single blob of prose — so adopting this feature does not silently restyle
 * every existing org's updates.
 *
 * Sections the model left empty are dropped rather than rendered as an empty
 * heading, because a heading with nothing under it reads as a broken page
 * rather than as an honest gap.
 */
export function assembleUpdateBody(format: UpdateFormat, values: Record<string, string>): string {
	const parts: string[] = [];

	for (const section of format.sections) {
		const text = (values[section.key] ?? '').trim();
		if (!text) continue;
		parts.push(format.sections.length === 1 ? text : `## ${section.label}\n\n${text}`);
	}

	return parts.join('\n\n');
}

// ============================================================
// The workflow itself
// ============================================================

/** One of the three voices. `content` is the whole system prompt. */
export interface WorkflowPrompt {
	content: string;
	model: string;
}

export interface WorkflowPrompts {
	responder: WorkflowPrompt;
	judge: WorkflowPrompt;
	drafter: WorkflowPrompt;
}

export type WorkflowTrigger =
	| { kind: 'manual' }
	| { kind: 'stage_change'; stageKey: string }
	| { kind: 'schedule'; everyMonths: number };

/**
 * Everything needed to run a workflow and to replay one.
 *
 * The shape a published `workflowVersions` row holds, and the shape a draft is
 * projected into to be run. One type for both so the engine cannot tell the
 * difference — which is what makes "preview this draft" possible later without
 * a second code path.
 */
export interface WorkflowDefinition {
	name: string;
	trigger: WorkflowTrigger;
	steps: CheckinStep[];
	report: UpdateFormat;
	prompts: WorkflowPrompts;
}

/**
 * The workflow this build ships, and the one a new org starts from.
 *
 * It reproduces the behaviour that shipped before workflows existed, including
 * the household rule — `kids_update` and `school_status` carry `requires`, so
 * a family with no children is not asked after children who are not there.
 * That rule used to be two hardcoded keys in `defaultObjectivesForFamily`;
 * carrying it here as data is the whole reason `requires` exists.
 *
 * The prompts are filled in by the caller from `checkin-prompts.ts` rather
 * than inlined, so the shipped wording has exactly one home.
 */
export function shippedWorkflowSteps(): CheckinStep[] {
	return [
		{
			key: 'checkin',
			title: 'How the family is doing',
			objectives: DEFAULT_CHECKIN_OBJECTIVES.map((objective) => ({
				...objective,
				...(objective.key === 'kids_update' ? { requires: ['hasChildren' as const] } : {}),
				...(objective.key === 'school_status'
					? { requires: ['hasSchoolAgeChildren' as const] }
					: {})
			}))
		}
	];
}

/** The report shape that reproduces the tool this engine shipped with. */
export const SHIPPED_REPORT: UpdateFormat = {
	titleGuidance: 'At most eight words.',
	instructions: '',
	sections: [
		{
			key: 'body',
			label: 'Update',
			guidance: 'Two or three short paragraphs of markdown. No headings or lists.'
		}
	]
};

// ============================================================
// The models a workflow may run on
// ============================================================

/**
 * One choosable model. `id` is the exact string sent to the API.
 *
 * The ids here are COMPLETE — no date suffix. A dated variant
 * (`claude-haiku-4-5-20251001`) is not the canonical id, and pinning one is how
 * a workflow quietly stays on an older snapshot than its author thinks.
 *
 * Prices are per million tokens and exist to make the tier choice legible at
 * the point of choosing. The judge runs on every turn of every conversation
 * and reads only the recent messages, so it is where the volume is and where a
 * cheaper tier pays for itself; the responder writes to a family in a fragile
 * situation, where the failure mode is a clumsy message rather than a slower
 * one.
 */
export interface WorkflowModel {
	id: string;
	label: string;
	inputPerMTok: number;
	outputPerMTok: number;
	contextLabel: string;
}

export const WORKFLOW_MODELS: WorkflowModel[] = [
	{
		id: 'claude-opus-5',
		label: 'Claude Opus 5',
		inputPerMTok: 5,
		outputPerMTok: 25,
		contextLabel: '1M'
	},
	{
		id: 'claude-sonnet-5',
		label: 'Claude Sonnet 5',
		inputPerMTok: 2,
		outputPerMTok: 10,
		contextLabel: '1M'
	},
	{
		id: 'claude-haiku-4-5',
		label: 'Claude Haiku 4.5',
		inputPerMTok: 1,
		outputPerMTok: 5,
		contextLabel: '200K'
	}
];

/** The tier each role starts on. See the note on WorkflowModel. */
export const DEFAULT_RESPONDER_MODEL = 'claude-opus-5';
export const DEFAULT_DRAFTER_MODEL = 'claude-opus-5';
export const DEFAULT_JUDGE_MODEL = 'claude-haiku-4-5';
