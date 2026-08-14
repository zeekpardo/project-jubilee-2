// ============================================================
// One turn of a check-in, with no database and no network in it
// ============================================================
// This is the conversation engine PLAN-ai-checkin.md calls "the hard part".
// Everything it needs arrives as arguments and everything it decides comes
// back as a value — including the rows that must be logged. The Convex action
// in convex/checkins/ supplies a real `CheckinModel` and writes what comes
// back; the golden-set tests in checkin-engine.test.ts supply a scripted one
// and assert on the same values. That is the whole reason this file has no
// imports from convex/.
//
// ORDER OF THE TWO CALLS. PLAN §3.2 numbers the responder first and the judge
// second. This runs them the other way round — judge, then responder — and the
// reason is §3.1: "the responder works through whichever objectives aren't yet
// answered and STOPS once it has them". A responder that runs before the
// judge cannot know that the message it is about to answer was the last one
// needed, so it asks one more question after the family has already told us
// everything. Rating first costs nothing (the judge never sees the responder's
// output anyway) and is what makes stopping possible. The plan's numbering is
// a description of the two calls, not a required sequence; the logging
// contract it actually specifies — one row per responder call, one per judge
// call, linked by conversation and turn — is unchanged.
//
// AN ESCALATION SHORT-CIRCUITS BOTH. Nothing below reaches a model when the
// incoming message trips the scanner. §3.3.
// ============================================================

import {
	decideNext,
	type CheckinDecision,
	type CheckinObjective,
	type ObjectiveCheck
} from './checkin-objectives';
import { scanForEscalation, type EscalationScan } from './checkin-escalation';
import {
	buildDrafterInput,
	buildJudgeInput,
	buildResponderInput,
	responderTools,
	RATE_OBJECTIVES_TOOL,
	type CheckinMessage,
	type PromptVersion,
	type ToolDefinition
} from './checkin-prompts';

// ============================================================
// The seam a real client and a scripted one both fit through
// ============================================================

export interface ResponderRequest {
	promptVersion: string;
	system: string;
	user: string;
	tools: ToolDefinition[];
}

export interface ResponderResult {
	/** The model id that actually served this, for the log. */
	model: string;
	/** The message to send. Null when the model only called a tool. */
	text: string | null;
	/** Present only when `draft_update` was called. */
	draft: { title: string; body: string } | null;
	latencyMs: number;
	inputTokens?: number;
	outputTokens?: number;
}

export interface JudgeRequest {
	promptVersion: string;
	system: string;
	user: string;
	tool: ToolDefinition;
}

export interface JudgeResult {
	model: string;
	checks: ObjectiveCheck[];
	latencyMs: number;
	inputTokens?: number;
	outputTokens?: number;
}

export interface CheckinModel {
	respond(request: ResponderRequest): Promise<ResponderResult>;
	judge(request: JudgeRequest): Promise<JudgeResult>;
}

// ============================================================
// What one turn produces
// ============================================================

/**
 * One `conversationTurns` row, in the shape §4 specifies: what was actually
 * SENT, not a delta. The API is stateless and every call resends the whole
 * context, so the log stores the whole context — otherwise "why did it respond
 * that way" is answerable only by reconstructing the prompt, which is exactly
 * the reconstruction that would be wrong after the next prompt edit.
 */
export interface CheckinTurnRecord {
	role: 'responder' | 'judge';
	promptVersion: string;
	model: string;
	input: string;
	output: string;
	latencyMs: number;
	inputTokens?: number;
	outputTokens?: number;
}

export interface CheckinAdvance {
	/** Set only when the incoming message tripped the scanner. */
	escalation: EscalationScan | null;
	/** Rows to append to `conversationTurns`, in call order. */
	records: CheckinTurnRecord[];
	/** Rows to append to `objectiveChecks`. Empty when no judge call was made. */
	checks: ObjectiveCheck[];
	decision: CheckinDecision;
	/** The message to send the family, when there is one. */
	outbound: string | null;
	/** The draft to write, when the conversation earned one. */
	draft: { title: string; body: string } | null;
}

export interface CheckinContext {
	objectives: CheckinObjective[];
	/** Every check logged for this conversation so far. */
	priorChecks: ObjectiveCheck[];
	/** The conversation so far, oldest first, NOT including `incoming`. */
	messages: CheckinMessage[];
	/** The family's new message, if this turn was triggered by one. */
	incoming: string | null;
	/** Responder calls already made in this conversation. */
	turnsSpent: number;
	/** What the responder may know about this family. Assembled by the caller. */
	profile: string;
	/** Only ever a `publicFirstName`; absent means the draft names nobody. */
	publicFirstName?: string;
	prompts: { responder: PromptVersion; drafter: PromptVersion; judge: PromptVersion };
}

/**
 * Ratings come back from a model, so they are treated as untrusted input even
 * though forced tool use guarantees the JSON parses.
 *
 * - a key outside the conversation's snapshotted objective set is DROPPED,
 *   not stored: it rates something this conversation is not pursuing.
 * - a non-finite or out-of-range number is clamped, not rejected. A rating of
 *   `NaN` should not lose the other three objectives' ratings with it.
 * - an empty or whitespace answer becomes `null`, because the whole point of
 *   the nullable field is that "nothing to report" has a representation, and
 *   `""` would otherwise sail past `answer === null` as an answer.
 */
export function normalizeChecks(
	objectives: CheckinObjective[],
	checks: ObjectiveCheck[]
): ObjectiveCheck[] {
	const known = new Set(objectives.map((objective) => objective.key));
	const clamp = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

	return checks
		.filter((check) => known.has(check.objective))
		.map((check) => ({
			objective: check.objective,
			rating: clamp(check.rating),
			confidence: clamp(check.confidence),
			answer: typeof check.answer === 'string' && check.answer.trim() ? check.answer.trim() : null
		}));
}

/**
 * Advance a conversation by one turn.
 *
 * Never writes anything and never sends anything. The caller decides what to do
 * with an escalation, a draft, or an outbound message — which is what lets the
 * same function serve a live WhatsApp turn, a golden-set scenario, and a replay
 * of a logged conversation against a new prompt version (§5).
 */
export async function advanceCheckin(
	context: CheckinContext,
	model: CheckinModel
): Promise<CheckinAdvance> {
	// ---- 1. Escalation, before anything else ---------------------------------
	if (context.incoming !== null) {
		const scan = scanForEscalation(context.incoming);
		if (scan.escalated) {
			return {
				escalation: scan,
				records: [],
				checks: [],
				decision: { kind: 'escalated' },
				outbound: null,
				draft: null
			};
		}
	}

	const records: CheckinTurnRecord[] = [];
	let checks: ObjectiveCheck[] = [];

	// The incoming message is part of the transcript both models read, so it is
	// appended here rather than by the caller — a judge that rated the turn
	// before this message would be rating the wrong turn.
	const messages: CheckinMessage[] =
		context.incoming === null
			? context.messages
			: [...context.messages, { role: 'family', text: context.incoming }];

	// ---- 2. Judge, when there is something to judge ---------------------------
	// No incoming message means this is the opening turn: nothing has been said,
	// so there is nothing to rate and the call would be a paid no-op.
	if (context.incoming !== null) {
		const user = buildJudgeInput({ objectives: context.objectives, messages });
		const result = await model.judge({
			promptVersion: context.prompts.judge.version,
			system: context.prompts.judge.content,
			user,
			tool: RATE_OBJECTIVES_TOOL
		});
		checks = normalizeChecks(context.objectives, result.checks);
		records.push({
			role: 'judge',
			promptVersion: context.prompts.judge.version,
			model: result.model,
			input: user,
			output: JSON.stringify({ checks }),
			latencyMs: result.latencyMs,
			inputTokens: result.inputTokens,
			outputTokens: result.outputTokens
		});
	}

	// ---- 3. Decide, in code -------------------------------------------------
	const decision = decideNext({
		objectives: context.objectives,
		checks: [...context.priorChecks, ...checks],
		turnsSpent: context.turnsSpent,
		escalated: false
	});

	// A conversation that needs a person gets no further model calls. Not for
	// cost — because the next thing this system would otherwise do is write
	// prose about a family whose answers we are not sure we understood.
	if (decision.kind === 'review') {
		return { escalation: null, records, checks, decision, outbound: null, draft: null };
	}

	// ---- 4a. Ask ------------------------------------------------------------
	if (decision.kind === 'ask') {
		const user = buildResponderInput({
			profile: context.profile,
			messages,
			outstanding: decision.objectives
		});
		const result = await model.respond({
			promptVersion: context.prompts.responder.version,
			system: context.prompts.responder.content,
			user,
			tools: responderTools('ask')
		});
		records.push({
			role: 'responder',
			promptVersion: context.prompts.responder.version,
			model: result.model,
			input: user,
			output: result.text ?? '',
			latencyMs: result.latencyMs,
			inputTokens: result.inputTokens,
			outputTokens: result.outputTokens
		});
		return { escalation: null, records, checks, decision, outbound: result.text, draft: null };
	}

	// ---- 4b. Draft ----------------------------------------------------------
	const user = buildDrafterInput({ messages, publicFirstName: context.publicFirstName });
	const result = await model.respond({
		promptVersion: context.prompts.drafter.version,
		system: context.prompts.drafter.content,
		user,
		tools: responderTools('draft')
	});
	records.push({
		role: 'responder',
		promptVersion: context.prompts.drafter.version,
		model: result.model,
		input: user,
		output: result.draft ? JSON.stringify(result.draft) : (result.text ?? ''),
		latencyMs: result.latencyMs,
		inputTokens: result.inputTokens,
		outputTokens: result.outputTokens
	});

	// The model answered in prose instead of calling `draft_update`. That is not
	// a draft — nothing wrote a title, and nothing agreed to the naming rules the
	// tool call represents — so it goes to a person rather than being salvaged
	// into one. Silently accepting the prose is how a draft with a family's real
	// name in it reaches an editor who assumes it was already policed.
	if (!result.draft) {
		return {
			escalation: null,
			records,
			checks,
			decision: { kind: 'review', reason: 'draft_failed', objectives: [] },
			outbound: null,
			draft: null
		};
	}

	return { escalation: null, records, checks, decision, outbound: null, draft: result.draft };
}
