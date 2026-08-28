// ============================================================
// Authored objective sets and authored update shapes
// ============================================================
// The rules here decide two things a person configured rather than a
// programmer shipped: which questions a family is asked, and what the post
// written about them is made of. Both are exercisable with no deployment and
// no API key, which is the whole reason they live in lib/domain.
//
// EVERY OBJECTIVE AND EVERY SECTION IN THIS FILE IS INVENTED, on the same rule
// as the golden set: no real family's data, and no real org's house style.
// ============================================================

import { describe, expect, it } from 'vitest';
import {
	assembleUpdateBody,
	captureValueFor,
	draftUpdateToolFor,
	DEFAULT_TEMPLATE,
	DEFAULT_UPDATE_FORMAT,
	resolveObjectives,
	templateObjectives,
	type CheckinTemplate,
	type UpdateFormat
} from './checkin-templates';
import {
	bestStates,
	decideNext,
	attemptsFor,
	classifyCheck,
	type CheckinObjective,
	type ObjectiveCheck
} from './checkin-objectives';

const TEMPLATE: CheckinTemplate = {
	version: 'template-test',
	name: 'Test',
	steps: [
		{
			key: 'work',
			title: 'Work',
			entryMessage: 'Ask about work before anything else.',
			objectives: [
				{
					key: 'job_status',
					label: 'Work',
					description: 'Whether anyone is working.',
					capture: { kind: 'field', entity: 'project', fieldKey: 'employment_status' },
					skipIfKnown: true
				},
				{
					key: 'job_kind',
					label: 'Kind of work',
					description: 'What the work actually is.',
					capture: {
						kind: 'field',
						entity: 'project',
						fieldKey: 'employment_kind',
						options: ['Farming', 'Construction', 'Trade']
					}
				}
			]
		},
		{
			key: 'home',
			title: 'Home',
			objectives: [
				{
					key: 'general_wellbeing',
					label: 'Wellbeing',
					description: 'How life is going.',
					// No capture: read by a person, filed nowhere.
					skipIfKnown: true
				}
			]
		}
	]
};

const check = (over: Partial<ObjectiveCheck> & { objective: string }): ObjectiveCheck => ({
	rating: 1,
	answer: 'yes',
	confidence: 1,
	...over
});

describe('templateObjectives', () => {
	it('flattens steps in author order', () => {
		expect(templateObjectives(TEMPLATE).map((o) => o.key)).toEqual([
			'job_status',
			'job_kind',
			'general_wellbeing'
		]);
	});
});

describe('resolveObjectives', () => {
	it('keeps everything when the record knows nothing', () => {
		const resolved = resolveObjectives(TEMPLATE, { knownKeys: new Set() });
		expect(resolved.map((o) => o.key)).toEqual(['job_status', 'job_kind', 'general_wellbeing']);
	});

	it('drops a known objective that files its answer', () => {
		const resolved = resolveObjectives(TEMPLATE, { knownKeys: new Set(['job_status']) });
		expect(resolved.map((o) => o.key)).toEqual(['job_kind', 'general_wellbeing']);
	});

	it('ignores skipIfKnown on an objective that captures nothing', () => {
		// general_wellbeing is skipIfKnown but files nowhere, so there is no
		// stored value that could stand in for asking. Asking is the only way to
		// learn it and a stale "known" flag must not silence it.
		const resolved = resolveObjectives(TEMPLATE, { knownKeys: new Set(['general_wellbeing']) });
		expect(resolved.map((o) => o.key)).toContain('general_wellbeing');
	});

	it('does not carry skipIfKnown onto the snapshot', () => {
		// It has been spent by the time the set is frozen. Keeping it would
		// preserve a decision as though it were still pending.
		const resolved = resolveObjectives(TEMPLATE, { knownKeys: new Set() });
		expect(resolved.every((o) => !('skipIfKnown' in o))).toBe(true);
	});

	it('carries the thresholds and the capture target onto the snapshot', () => {
		const resolved = resolveObjectives(TEMPLATE, { knownKeys: new Set() });
		const jobKind = resolved.find((o) => o.key === 'job_kind');
		expect(jobKind?.capture).toEqual({
			kind: 'field',
			entity: 'project',
			fieldKey: 'employment_kind',
			options: ['Farming', 'Construction', 'Trade']
		});
	});

	it('resolves the shipped default to the four objectives it replaces', () => {
		const resolved = resolveObjectives(DEFAULT_TEMPLATE, { knownKeys: new Set() });
		expect(resolved.map((o) => o.key)).toEqual([
			'job_status',
			'school_status',
			'kids_update',
			'general_wellbeing'
		]);
		expect(resolved.every((o) => o.capture === undefined)).toBe(true);
	});
});

describe('captureValueFor', () => {
	const target = templateObjectives(TEMPLATE);
	const jobStatus = target[0];
	const jobKind = target[1];
	const wellbeing = target[2];

	it('files an accepted answer', () => {
		expect(captureValueFor(jobStatus, { state: 'answered', answer: 'Working' })).toEqual({
			entity: 'project',
			fieldKey: 'employment_status',
			value: 'Working'
		});
	});

	it('writes nothing for an objective that captures nothing', () => {
		expect(captureValueFor(wellbeing, { state: 'answered', answer: 'Fine' })).toBeNull();
	});

	it('writes nothing when the reading is not trusted', () => {
		// The whole point of the state gate: editing a family's record off a
		// reading we flagged for a human is the write a human should be making.
		expect(captureValueFor(jobStatus, { state: 'needs_review', answer: 'Working' })).toBeNull();
		expect(captureValueFor(jobStatus, { state: 'unanswered', answer: 'Working' })).toBeNull();
	});

	it('writes nothing for a blank answer', () => {
		expect(captureValueFor(jobStatus, { state: 'answered', answer: '   ' })).toBeNull();
		expect(captureValueFor(jobStatus, { state: 'answered', answer: null })).toBeNull();
	});

	it('coerces a picklist answer to the option, ignoring case', () => {
		expect(captureValueFor(jobKind, { state: 'answered', answer: 'farming' })?.value).toBe(
			'Farming'
		);
	});

	it('refuses a picklist answer that is not an option', () => {
		// A picklist that accepts free text is not a picklist.
		expect(captureValueFor(jobKind, { state: 'answered', answer: 'Fishing' })).toBeNull();
	});
});

describe('per-objective thresholds', () => {
	const lenient: CheckinObjective = {
		key: 'a',
		label: 'A',
		description: 'x',
		minRating: 0.3,
		minConfidence: 0.3
	};
	const strict: CheckinObjective = {
		key: 'b',
		label: 'B',
		description: 'x',
		minRating: 0.95,
		minConfidence: 0.95
	};

	it('accepts under a lowered bar and rejects the same rating under a raised one', () => {
		const rating = check({ objective: 'a', rating: 0.5, confidence: 0.5 });
		expect(classifyCheck(rating, lenient)).toBe('answered');
		expect(classifyCheck({ ...rating, objective: 'b' }, strict)).toBe('unanswered');
	});

	it('falls back to the constants when the objective sets none', () => {
		const plain: CheckinObjective = { key: 'c', label: 'C', description: 'x' };
		expect(classifyCheck(check({ objective: 'c', rating: 0.5, confidence: 1 }), plain)).toBe(
			'unanswered'
		);
		expect(classifyCheck(check({ objective: 'c', rating: 0.8, confidence: 1 }), plain)).toBe(
			'answered'
		);
	});

	it('bestStates applies each objective its own bar', () => {
		const states = bestStates(
			[lenient, strict],
			[
				check({ objective: 'a', rating: 0.5, confidence: 0.5 }),
				check({ objective: 'b', rating: 0.5, confidence: 0.5 })
			]
		);
		expect(states.get('a')).toBe('answered');
		expect(states.get('b')).toBe('unanswered');
	});
});

describe('maxAttempts', () => {
	const capped: CheckinObjective = {
		key: 'school',
		label: 'School',
		description: 'x',
		maxAttempts: 2
	};
	const open: CheckinObjective = { key: 'work', label: 'Work', description: 'x' };
	const unanswered = (objective: string) =>
		check({ objective, rating: 0, answer: null, confidence: 0 });

	it('counts one attempt per rating', () => {
		expect(attemptsFor('school', [unanswered('school'), unanswered('school')])).toBe(2);
		expect(attemptsFor('school', [unanswered('work')])).toBe(0);
	});

	it('keeps asking while attempts remain', () => {
		const decision = decideNext({
			objectives: [capped],
			checks: [unanswered('school')],
			turnsSpent: 1,
			escalated: false
		});
		expect(decision.kind).toBe('ask');
	});

	it('stops asking a spent objective but still asks the others', () => {
		const decision = decideNext({
			objectives: [capped, open],
			checks: [unanswered('school'), unanswered('school'), unanswered('work')],
			turnsSpent: 2,
			escalated: false
		});
		expect(decision.kind).toBe('ask');
		if (decision.kind !== 'ask') throw new Error('expected ask');
		expect(decision.objectives.map((o) => o.key)).toEqual(['work']);
	});

	it('sends a spent objective to a person rather than drafting over it', () => {
		// The dangerous outcome this guards: a confident-looking post whose
		// missing answer nobody was told about.
		const decision = decideNext({
			objectives: [capped, open],
			checks: [
				unanswered('school'),
				unanswered('school'),
				check({ objective: 'work', rating: 1, answer: 'Farming', confidence: 1 })
			],
			turnsSpent: 2,
			escalated: false
		});
		expect(decision).toMatchObject({ kind: 'review', reason: 'exhausted' });
	});
});

describe('draftUpdateToolFor', () => {
	const format: UpdateFormat = {
		version: 'format-test',
		name: 'Test',
		titleGuidance: 'Six words at most.',
		instructions: 'Never name a child.',
		sections: [
			{ key: 'whats_new', label: "What's new", guidance: 'Lead with their own words.' },
			{ key: 'ahead', label: 'Looking ahead', guidance: 'What comes next.', approxWords: 60 }
		]
	};

	it('makes one required property per section, plus the title', () => {
		const tool = draftUpdateToolFor(format);
		expect(Object.keys(tool.input_schema.properties)).toEqual(['title', 'whats_new', 'ahead']);
		expect(tool.input_schema.required).toEqual(['title', 'whats_new', 'ahead']);
		expect(tool.input_schema.additionalProperties).toBe(false);
	});

	it('keeps the tool name fixed so the forbidden-name check cannot be routed around', () => {
		expect(draftUpdateToolFor(format).name).toBe('draft_update');
	});

	it('folds the word target into the description', () => {
		const tool = draftUpdateToolFor(format);
		expect(tool.input_schema.properties.ahead).toMatchObject({
			description: 'What comes next. Around 60 words.'
		});
	});

	it('reproduces the shipped shape from the default format', () => {
		const tool = draftUpdateToolFor(DEFAULT_UPDATE_FORMAT);
		expect(tool.input_schema.required).toEqual(['title', 'body']);
		expect(tool.input_schema.properties.title).toMatchObject({
			description: 'At most eight words.'
		});
	});
});

describe('assembleUpdateBody', () => {
	const twoSections: UpdateFormat = {
		...DEFAULT_UPDATE_FORMAT,
		sections: [
			{ key: 'a', label: 'First', guidance: '' },
			{ key: 'b', label: 'Second', guidance: '' }
		]
	};

	it('writes no heading for a single-section format', () => {
		// This is what keeps an org that adopts formats from silently having
		// every existing update restyled.
		expect(assembleUpdateBody(DEFAULT_UPDATE_FORMAT, { body: 'One blob.' })).toBe('One blob.');
	});

	it('heads each section when there is more than one', () => {
		expect(assembleUpdateBody(twoSections, { a: 'Alpha.', b: 'Beta.' })).toBe(
			'## First\n\nAlpha.\n\n## Second\n\nBeta.'
		);
	});

	it('drops a section the model left empty rather than printing a bare heading', () => {
		expect(assembleUpdateBody(twoSections, { a: 'Alpha.', b: '   ' })).toBe('## First\n\nAlpha.');
	});

	it('ignores properties the format does not declare', () => {
		expect(assembleUpdateBody(twoSections, { a: 'Alpha.', b: 'Beta.', c: 'Stray.' })).not.toContain(
			'Stray.'
		);
	});
});
