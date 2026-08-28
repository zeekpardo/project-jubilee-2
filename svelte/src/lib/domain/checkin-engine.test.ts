// ============================================================
// The golden set
// ============================================================
// PLAN-ai-checkin.md §5: five to ten synthetic scenarios that run before
// anything ships. A normal update, a struggling family, a non-responsive
// family, an ambiguous answer, a family with no school-age kids, and a
// crisis disclosure — all six are here, plus the two structural guarantees §3
// makes that are not scenarios at all (no publish tool, no profile for the
// judge).
//
// EVERY FAMILY IN THIS FILE IS INVENTED. §2: real family data never enters a
// fixture. The messages are modelled on the shape of real replies — short,
// second-language, phone-typed — and none of them came from anybody.
//
// The model is scripted. The whole reason `advanceCheckin` takes a
// `CheckinModel` is so this file can run the real control flow with no API key,
// no network and no deployment, and assert on what the engine DECIDED rather
// than on what a model happened to say that morning.
// ============================================================

import { describe, expect, it } from 'vitest';
import { advanceCheckin, type CheckinModel, type ResponderRequest } from './checkin-engine';
import {
	defaultObjectivesForFamily,
	MAX_RESPONDER_TURNS,
	type CheckinObjective,
	type ObjectiveCheck
} from './checkin-objectives';
import { DRAFTER_V1, JUDGE_V1, RESPONDER_V1, type CheckinMessage } from './checkin-prompts';

const PROMPTS = { responder: RESPONDER_V1, drafter: DRAFTER_V1, judge: JUDGE_V1 };

const FULL_FAMILY = defaultObjectivesForFamily({
	hasChildren: true,
	hasSchoolAgeChildren: true
});

/** A stand-in profile. Deliberately as thin as the real one. */
const PROFILE = 'You are messaging Amina.\nThe family: Amina, Yusuf, Leila (a child).';

interface Script {
	/** Ratings the judge returns, given the turn number (1-based). */
	judge?: (turn: number) => ObjectiveCheck[];
	/** What the responder produces. Defaults to a plausible question. */
	respond?: (
		turn: number,
		request: ResponderRequest
	) => { text?: string | null; draft?: { title: string; body: string } | null };
}

function scriptedModel(script: Script) {
	const seen = { judge: [] as string[], respond: [] as ResponderRequest[] };
	let judgeTurn = 0;
	let respondTurn = 0;

	const model: CheckinModel = {
		async judge(request) {
			judgeTurn += 1;
			seen.judge.push(request.user);
			return {
				model: 'scripted-judge',
				checks: script.judge ? script.judge(judgeTurn) : [],
				latencyMs: 1
			};
		},
		async respond(request) {
			respondTurn += 1;
			seen.respond.push(request);
			const result = script.respond?.(respondTurn, request) ?? {};
			return {
				model: 'scripted-responder',
				text: result.text ?? 'How are things going?',
				// Scenarios script a draft the way a reviewer reads one — a title and
				// a body. The default format's single section IS `body`, so this is
				// the translation into the tool-input shape the client now returns,
				// not a change to what any scenario asserts.
				draft: result.draft
					? { title: result.draft.title, sections: { body: result.draft.body } }
					: null,
				latencyMs: 1
			};
		}
	};
	return { model, seen };
}

/**
 * Drive a whole conversation, exactly the way the Convex layer does: append the
 * outbound message, feed the next scripted reply, accumulate ratings, and count
 * a spent turn per responder call.
 */
async function runConversation(input: {
	objectives: CheckinObjective[];
	replies: (string | null)[];
	script: Script;
}) {
	const { model, seen } = scriptedModel(input.script);
	const messages: CheckinMessage[] = [];
	const checks: ObjectiveCheck[] = [];
	let turnsSpent = 0;
	let incoming: string | null = null;
	const decisions: string[] = [];
	let draft: { title: string; body: string } | null = null;
	let escalated = false;

	for (let step = 0; step <= input.replies.length; step += 1) {
		const advance = await advanceCheckin(
			{
				objectives: input.objectives,
				priorChecks: checks,
				messages,
				incoming,
				turnsSpent,
				profile: PROFILE,
				publicFirstName: 'Amina',
				prompts: PROMPTS
			},
			model
		);

		decisions.push(advance.decision.kind);
		if (incoming !== null) messages.push({ role: 'family', text: incoming });
		checks.push(...advance.checks);
		turnsSpent += advance.records.filter((record) => record.role === 'responder').length;
		if (advance.outbound) messages.push({ role: 'assistant', text: advance.outbound });
		if (advance.draft) draft = advance.draft;
		if (advance.escalation?.escalated) {
			escalated = true;
			break;
		}
		if (advance.decision.kind !== 'ask') break;

		const reply = input.replies[step];
		if (reply === undefined) break;
		incoming = reply;
		// A silent family: nothing arrives, so the transport never triggers
		// another turn. The loop below models that as an explicit empty step.
		if (reply === null) break;
	}

	return { decisions, draft, checks, turnsSpent, messages, seen, escalated };
}

const answered = (key: string, answer = 'they told us'): ObjectiveCheck => ({
	objective: key,
	rating: 0.95,
	confidence: 0.95,
	answer
});

const silent = (key: string): ObjectiveCheck => ({
	objective: key,
	rating: 0,
	confidence: 0.9,
	answer: null
});

describe('golden set', () => {
	it('1. a normal update: every objective answered, a draft produced', async () => {
		const run = await runConversation({
			objectives: FULL_FAMILY,
			replies: [
				'Yusuf is working at the brick yard now, six days. Leila started school in January and she likes it. We are all well, thank you for asking.'
			],
			script: {
				judge: () => FULL_FAMILY.map((objective) => answered(objective.key)),
				respond: (turn) =>
					turn === 1
						? { text: 'Hello Amina, how have things been this month?' }
						: {
								draft: {
									title: 'Steady work and a new school year',
									body: 'The family reports steady work and a child settled into school.'
								}
							}
			}
		});

		expect(run.decisions).toContain('draft');
		expect(run.draft?.title).toBe('Steady work and a new school year');
	});

	it('2. a struggling family: bad news is still an answer, and still drafts', async () => {
		// The point of this scenario is that "things are hard" is not a failure
		// state for the engine. An objective answered badly is answered.
		const run = await runConversation({
			objectives: FULL_FAMILY,
			replies: [
				'There is no work since the rains. The children are home, we could not pay the school fee. We are eating but it is difficult.'
			],
			script: {
				judge: () => FULL_FAMILY.map((objective) => answered(objective.key, 'a hard month')),
				respond: (turn) =>
					turn === 1
						? { text: 'How has this month been?' }
						: {
								draft: {
									title: 'A hard season',
									body: 'Work has stopped and school fees are unpaid.'
								}
							}
			}
		});

		expect(run.decisions).toContain('draft');
		expect(run.draft?.title).toBe('A hard season');
	});

	it('3. a non-responsive family: asks up to the cap, then hands to a person', async () => {
		// Nothing ever comes back. The engine must not keep asking forever, and
		// must not draft a post out of four unanswered questions.
		const objectives = FULL_FAMILY;
		const checks: ObjectiveCheck[] = [];
		const { model } = scriptedModel({ judge: () => objectives.map((o) => silent(o.key)) });
		const messages: CheckinMessage[] = [];
		let turnsSpent = 0;
		let lastDecision = '';

		for (let turn = 0; turn <= MAX_RESPONDER_TURNS + 1; turn += 1) {
			const advance = await advanceCheckin(
				{
					objectives,
					priorChecks: checks,
					messages,
					// A one-word reply that answers nothing — the realistic version of
					// non-response once a conversation has started.
					incoming: turn === 0 ? null : 'ok',
					turnsSpent,
					profile: PROFILE,
					prompts: PROMPTS
				},
				model
			);
			checks.push(...advance.checks);
			turnsSpent += advance.records.filter((r) => r.role === 'responder').length;
			if (advance.outbound) messages.push({ role: 'assistant', text: advance.outbound });
			lastDecision = advance.decision.kind;
			if (lastDecision !== 'ask') break;
		}

		expect(turnsSpent).toBe(MAX_RESPONDER_TURNS);
		expect(lastDecision).toBe('review');
	});

	it('4. an ambiguous answer: routed to a person, never re-asked, never drafted', async () => {
		const run = await runConversation({
			objectives: FULL_FAMILY,
			replies: ['it is going'],
			script: {
				judge: () => [
					answered('job_status'),
					// The judge read something, and says plainly it is not sure.
					{ objective: 'school_status', rating: 0.8, confidence: 0.35, answer: 'maybe attending' },
					answered('kids_update'),
					answered('general_wellbeing')
				]
			}
		});

		expect(run.decisions.at(-1)).toBe('review');
		expect(run.draft).toBeNull();
		// One responder call — the opening message — and no second question about
		// the objective we merely failed to understand.
		expect(run.turnsSpent).toBe(1);
	});

	it('5. a family with no school-age kids is never asked about school', async () => {
		const objectives = defaultObjectivesForFamily({
			hasChildren: false,
			hasSchoolAgeChildren: false
		});
		expect(objectives.map((o) => o.key)).not.toContain('school_status');

		const run = await runConversation({
			objectives,
			replies: ['We are both working now and keeping well.'],
			script: {
				judge: () => objectives.map((objective) => answered(objective.key)),
				respond: (turn) =>
					turn === 1
						? { text: 'How are you both?' }
						: { draft: { title: 'Both working', body: 'Steady work, and keeping well.' } }
			}
		});

		const everythingSent = run.seen.respond.map((request) => request.user).join('\n');
		expect(everythingSent).not.toContain('school_status');
		expect(run.decisions).toContain('draft');
	});

	it('6. a crisis disclosure escalates before any model is called', async () => {
		let called = false;
		const model: CheckinModel = {
			async judge() {
				called = true;
				throw new Error('the judge must not run on an escalating message');
			},
			async respond() {
				called = true;
				throw new Error('the responder must not run on an escalating message');
			}
		};

		const advance = await advanceCheckin(
			{
				objectives: FULL_FAMILY,
				priorChecks: [],
				messages: [{ role: 'assistant', text: 'How have things been?' }],
				incoming: 'he hit me again and I am afraid for my life',
				turnsSpent: 1,
				profile: PROFILE,
				prompts: PROMPTS
			},
			model
		);

		expect(called).toBe(false);
		expect(advance.decision.kind).toBe('escalated');
		expect(advance.escalation?.escalated).toBe(true);
		expect(advance.records).toHaveLength(0);
		expect(advance.draft).toBeNull();
		// And nothing was said back to the family. A bot replying to a disclosure
		// is exactly what §3.3 is preventing.
		expect(advance.outbound).toBeNull();
	});

	it('7. a drafting call that returns prose instead of a tool call goes to a person', async () => {
		const run = await runConversation({
			objectives: FULL_FAMILY,
			replies: ['All is well, work is steady, the children are in school.'],
			script: {
				judge: () => FULL_FAMILY.map((objective) => answered(objective.key)),
				// Second call is the drafting one, and it answers in prose.
				respond: (turn) =>
					turn === 1
						? { text: 'How are things?' }
						: { text: 'Here is a lovely update!', draft: null }
			}
		});

		expect(run.draft).toBeNull();
		expect(run.decisions.at(-1)).toBe('review');
	});
});

describe('structural guarantees', () => {
	it('the responder is never handed a publishing tool', async () => {
		const run = await runConversation({
			objectives: FULL_FAMILY,
			replies: ['We are well.'],
			script: {
				judge: () => FULL_FAMILY.map((objective) => answered(objective.key)),
				respond: (turn) =>
					turn === 1 ? { text: 'Hello' } : { draft: { title: 'A month on', body: 'All well.' } }
			}
		});

		const toolNames = run.seen.respond.flatMap((request) => request.tools.map((t) => t.name));
		expect(toolNames).not.toContain('publish_update');
		// The only tool that exists at all is the drafting one, and only on the
		// drafting call.
		expect(new Set(toolNames)).toEqual(new Set(['draft_update']));
	});

	it('the judge never sees the family profile or the full history', async () => {
		const run = await runConversation({
			objectives: FULL_FAMILY,
			replies: ['We are well.'],
			script: { judge: () => FULL_FAMILY.map((objective) => answered(objective.key)) }
		});

		for (const judgeInput of run.seen.judge) {
			expect(judgeInput).not.toContain('You are messaging Amina');
			expect(judgeInput).not.toContain('Yusuf');
		}
		// It does see the objective descriptions, which is the whole of what §3.2
		// says it may have.
		expect(run.seen.judge[0]).toContain('job_status');
	});

	it('logs one row per model call, tagged with the version that produced it', async () => {
		const advance = await advanceCheckin(
			{
				objectives: FULL_FAMILY,
				priorChecks: [],
				messages: [{ role: 'assistant', text: 'Hello' }],
				incoming: 'we are well',
				turnsSpent: 1,
				profile: PROFILE,
				prompts: PROMPTS
			},
			scriptedModel({ judge: () => [answered('job_status')] }).model
		);

		expect(advance.records.map((record) => record.role)).toEqual(['judge', 'responder']);
		expect(advance.records[0].promptVersion).toBe(JUDGE_V1.version);
		expect(advance.records[1].promptVersion).toBe(RESPONDER_V1.version);
		// The full input is stored, not a delta — §4.
		expect(advance.records[1].input).toContain('You are messaging Amina');
	});

	it('drops a rating for an objective the conversation is not pursuing', async () => {
		const advance = await advanceCheckin(
			{
				objectives: FULL_FAMILY,
				priorChecks: [],
				messages: [],
				incoming: 'hello',
				turnsSpent: 1,
				profile: PROFILE,
				prompts: PROMPTS
			},
			scriptedModel({
				judge: () => [answered('job_status'), answered('something_nobody_asked_for')]
			}).model
		);

		expect(advance.checks.map((check) => check.objective)).toEqual(['job_status']);
	});

	it('clamps a nonsense rating instead of losing the turn', async () => {
		const advance = await advanceCheckin(
			{
				objectives: FULL_FAMILY,
				priorChecks: [],
				messages: [],
				incoming: 'hello',
				turnsSpent: 1,
				profile: PROFILE,
				prompts: PROMPTS
			},
			scriptedModel({
				judge: () => [{ objective: 'job_status', rating: 42, confidence: Number.NaN, answer: '  ' }]
			}).model
		);

		expect(advance.checks[0]).toMatchObject({ rating: 1, confidence: 0, answer: null });
	});
});
