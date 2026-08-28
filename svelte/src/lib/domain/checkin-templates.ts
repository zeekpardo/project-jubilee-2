// ============================================================
// What the org decided to ask, and what shape the report comes back in
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
	input: { knownKeys: ReadonlySet<string> }
): CheckinObjective[] {
	const resolved: CheckinObjective[] = [];

	for (const objective of templateObjectives(template)) {
		const capturesField = objective.capture?.kind === 'field';
		if (objective.skipIfKnown && capturesField && input.knownKeys.has(objective.key)) continue;

		const { skipIfKnown: _skipIfKnown, ...snapshot } = objective;
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
	version: string;
	name: string;
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
// What a fresh org starts from
// ============================================================

/**
 * The template that reproduces the behaviour this engine shipped with: the
 * four objectives from checkin-objectives.ts, in one step, capturing nothing.
 *
 * It exists so that "adopt templates" is not also "change what your check-ins
 * ask". An org that seeds this and never edits it gets the conversation it had
 * before — which is the only honest default for a feature whose whole job is
 * to let people change that conversation.
 *
 * The two objectives the old hardcoded rule dropped for families without
 * children are NOT expressed here. That rule read a household, and
 * `skipIfKnown` reads a captured field; they are different mechanisms and
 * pretending otherwise would quietly change who gets asked what. Migrating it
 * properly is a template an author writes, not a default this file guesses.
 */
export const DEFAULT_TEMPLATE: CheckinTemplate = {
	version: 'template-1',
	name: 'Family check-in',
	steps: [
		{
			key: 'wellbeing',
			title: 'How the family is doing',
			// Straight from DEFAULT_CHECKIN_OBJECTIVES, capturing nothing: the
			// shipped conversation, expressed as data.
			objectives: DEFAULT_CHECKIN_OBJECTIVES.map((objective) => ({ ...objective }))
		}
	]
};

/** The format that reproduces the shipped `DRAFT_UPDATE_TOOL` exactly. */
export const DEFAULT_UPDATE_FORMAT: UpdateFormat = {
	version: 'format-1',
	name: 'Default',
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
