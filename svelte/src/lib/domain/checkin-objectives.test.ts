import { describe, expect, it } from 'vitest';
import {
	bestStates,
	classifyCheck,
	DEFAULT_CHECKIN_OBJECTIVES,
	decideNext,
	defaultObjectivesForFamily,
	MAX_RESPONDER_TURNS,
	type CheckinObjective,
	type ObjectiveCheck
} from './checkin-objectives';

const OBJECTIVES: CheckinObjective[] = DEFAULT_CHECKIN_OBJECTIVES;

const check = (
	objective: string,
	rating: number,
	confidence: number,
	answer: string | null = 'they said something'
): ObjectiveCheck => ({ objective, rating, confidence, answer });

const answeredAll = (): ObjectiveCheck[] =>
	OBJECTIVES.map((objective) => check(objective.key, 0.95, 0.95));

describe('defaultObjectivesForFamily', () => {
	it('does not ask a family without children about their children', () => {
		const objectives = defaultObjectivesForFamily({
			hasChildren: false,
			hasSchoolAgeChildren: false
		});
		expect(objectives.map((o) => o.key)).toEqual(['job_status', 'general_wellbeing']);
	});

	it('asks about children but not school when none are school-age', () => {
		const objectives = defaultObjectivesForFamily({
			hasChildren: true,
			hasSchoolAgeChildren: false
		});
		expect(objectives.map((o) => o.key)).toEqual([
			'job_status',
			'kids_update',
			'general_wellbeing'
		]);
	});
});

describe('classifyCheck', () => {
	it('treats a null answer as unanswered whatever the rating claims', () => {
		// The nullable answer is the anti-fabrication signal. A high rating with
		// nothing to show for it is an internally inconsistent result, and the
		// safe reading of a contradiction is that nothing was answered.
		expect(classifyCheck(check('job_status', 1, 1, null))).toBe('unanswered');
	});

	it('treats a confident, well-rated answer as answered', () => {
		expect(classifyCheck(check('job_status', 0.9, 0.9))).toBe('answered');
	});

	it('sends a well-rated but low-confidence answer to review, not back to the family', () => {
		expect(classifyCheck(check('job_status', 0.9, 0.3))).toBe('needs_review');
	});

	it('treats a weak rating as unanswered even when the judge is sure', () => {
		expect(classifyCheck(check('job_status', 0.2, 1))).toBe('unanswered');
	});
});

describe('bestStates', () => {
	it('takes the best rating an objective ever got, not the latest', () => {
		// A family answers about school in turn two and talks about the weather in
		// turn three. The judge only sees recent turns, so turn three rates school
		// at zero — and taking the latest would re-ask a question they answered.
		const states = bestStates(OBJECTIVES, [
			check('school_status', 0.95, 0.95),
			check('school_status', 0, 0.9, null)
		]);
		expect(states.get('school_status')).toBe('answered');
	});

	it('ignores a rating for an objective this conversation is not pursuing', () => {
		const twoObjectives = OBJECTIVES.slice(0, 2);
		const states = bestStates(twoObjectives, [check('something_else', 1, 1)]);
		expect(states.has('something_else')).toBe(false);
	});
});

describe('decideNext', () => {
	it('escalation outranks everything, including a finished conversation', () => {
		const decision = decideNext({
			objectives: OBJECTIVES,
			checks: answeredAll(),
			turnsSpent: 1,
			escalated: true
		});
		// Specifically NOT 'draft'. A family that has just disclosed danger does
		// not get a blog post written about their good news.
		expect(decision.kind).toBe('escalated');
	});

	it('asks about what is still outstanding', () => {
		const decision = decideNext({
			objectives: OBJECTIVES,
			checks: [check('job_status', 0.9, 0.9)],
			turnsSpent: 1,
			escalated: false
		});
		expect(decision.kind).toBe('ask');
		if (decision.kind !== 'ask') return;
		expect(decision.objectives.map((o) => o.key)).not.toContain('job_status');
		expect(decision.objectives.map((o) => o.key)).toContain('school_status');
	});

	it('drafts once every objective is answered with confidence', () => {
		const decision = decideNext({
			objectives: OBJECTIVES,
			checks: answeredAll(),
			turnsSpent: 3,
			escalated: false
		});
		expect(decision.kind).toBe('draft');
	});

	it('routes a low-confidence reading to a person instead of drafting', () => {
		const checks = answeredAll();
		checks[1] = check('school_status', 0.9, 0.4);
		const decision = decideNext({
			objectives: OBJECTIVES,
			checks,
			turnsSpent: 3,
			escalated: false
		});
		expect(decision).toMatchObject({ kind: 'review', reason: 'low_confidence' });
	});

	it('does not re-ask an objective it is merely unsure about', () => {
		// The family DID answer. Asking again is the machine telling them it did
		// not understand, which is a cost paid by the family for our problem.
		const checks = answeredAll();
		checks[1] = check('school_status', 0.9, 0.4);
		const decision = decideNext({
			objectives: OBJECTIVES,
			checks,
			turnsSpent: 1,
			escalated: false
		});
		expect(decision.kind).not.toBe('ask');
	});

	it('stops asking at the turn cap and hands over', () => {
		const decision = decideNext({
			objectives: OBJECTIVES,
			checks: [],
			turnsSpent: MAX_RESPONDER_TURNS,
			escalated: false
		});
		expect(decision).toMatchObject({ kind: 'review', reason: 'exhausted' });
	});

	it('keeps asking right up to the cap', () => {
		const decision = decideNext({
			objectives: OBJECTIVES,
			checks: [],
			turnsSpent: MAX_RESPONDER_TURNS - 1,
			escalated: false
		});
		expect(decision.kind).toBe('ask');
	});
});
