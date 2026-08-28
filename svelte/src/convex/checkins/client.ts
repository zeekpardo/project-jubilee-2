'use node';

// ============================================================
// The real `CheckinModel` — the only file that talks to Anthropic
// ============================================================
// `"use node"` even though nothing here is a registered function: Convex bundles
// every file under the functions directory in its own right, so a module that
// pulls in the Anthropic SDK has to declare the runtime it needs whether or not
// anything imports it. Without it the deploy fails on the SDK's `node:fs`
// credential loader rather than on anything this file does.
// ============================================================
// `lib/domain/checkin-engine.ts` decides what to ask and when to stop, against
// an interface. This is the implementation of that interface that costs money.
// The golden-set tests supply a different one; nothing else in the codebase
// imports this file except the action that runs a live turn.
//
// TWO CALLS, TWO SHAPES.
//
//   responder — `tool_choice: auto`, top-tier model, adaptive thinking. Writes
//               a message to a family, or calls `draft_update`.
//   judge     — forced `tool_choice: {type:'tool', name:'rate_objectives'}` on
//               a Haiku-tier model. Forced tool use guarantees the JSON parses;
//               it guarantees nothing about the values, which is why the engine
//               normalizes everything that comes back.
//
// REFUSALS ARE EXPECTED HERE. This is a system whose incoming messages are
// about bonded labour, abuse and coercion, so a safety classifier declining a
// request is a normal Tuesday rather than an exotic failure. `stop_reason` is
// checked before `content` is read, server-side fallbacks are on, and a refusal
// that survives the fallback surfaces as a typed error the caller turns into a
// human handoff — never into a missing turn nobody notices.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages';
import type {
	CheckinModel,
	JudgeRequest,
	JudgeResult,
	ResponderRequest,
	ResponderResult
} from '../../lib/domain/checkin-engine';
import type { ObjectiveCheck } from '../../lib/domain/checkin-objectives';
import { anthropicApiKey, judgeModel, responderModel } from './env';

/**
 * A model call that came back with nothing usable — a policy refusal, a
 * truncated response, a forced tool call the model somehow did not make.
 *
 * Its own class so the action can tell it apart from a network failure: a
 * refusal is a conversation that needs a person, and a timeout is a turn to
 * retry.
 */
export class CheckinModelError extends Error {
	constructor(
		message: string,
		/** WHICH call failed. The trace is the audit trail; a judge failure logged
		 *  as a responder failure makes it a lying one. */
		readonly role: 'responder' | 'judge',
		readonly cause?: unknown
	) {
		super(message);
		this.name = 'CheckinModelError';
	}
}

export class CheckinModelRefusal extends CheckinModelError {
	constructor(
		message: string,
		role: 'responder' | 'judge',
		readonly category: string | null
	) {
		super(message, role);
		this.name = 'CheckinModelRefusal';
	}
}

/**
 * Opting into server-side fallbacks by default, in the `"default"` form rather
 * than by naming a substitute model.
 *
 * Naming one would be a second model id to keep current, and the right
 * substitute depends on WHY the request was declined — which is a routing
 * decision the API already makes better than a constant in this file can.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Server-side fallbacks are not accepted by every model — Haiku rejects the
 * parameter outright with a 400, and so does any tier that has no fallback
 * chain published for it.
 *
 * Found the hard way: sending it on the judge call killed every turn with
 * `'claude-haiku-4-5-20251001' does not support the `fallbacks` parameter`,
 * which is a configuration error wearing the costume of a model failure.
 *
 * A prefix allowlist rather than a try-and-retry: the set of models with a
 * fallback chain is small and known, and a retry loop around a 400 would spend
 * a request to rediscover a fact this constant already states.
 */
const FALLBACK_CAPABLE = ['claude-opus-5', 'claude-opus-4-8', 'claude-fable-5', 'claude-mythos-5'];

function fallbackParams(model: string): Record<string, unknown> {
	if (!FALLBACK_CAPABLE.some((candidate) => model.startsWith(candidate))) return {};
	return { betas: [FALLBACK_BETA], fallbacks: 'default' as const };
}

/**
 * Generous relative to the output — a WhatsApp message is two sentences.
 *
 * The headroom is for thinking: `max_tokens` caps thinking plus response text
 * together, and thinking is on by default on this tier, so a limit sized to the
 * visible answer truncates mid-thought. Well under the ten-minute non-streaming
 * ceiling either way.
 */
const RESPONDER_MAX_TOKENS = 8000;

/** Four objectives, one short sentence and two numbers each. */
const JUDGE_MAX_TOKENS = 2048;

function textFrom(message: BetaMessage): string | null {
	const parts = message.content
		.filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
		.map((block) => block.text.trim())
		.filter(Boolean);
	return parts.length > 0 ? parts.join('\n\n') : null;
}

function toolInput(message: BetaMessage, name: string): unknown {
	for (const block of message.content) {
		if (block.type === 'tool_use' && block.name === name) return block.input;
	}
	return null;
}

/**
 * Checked before `content` is read on every call, per the API's own guidance:
 * a refusal is an HTTP 200 with an empty or partial `content`, so code that
 * indexes into it first breaks on exactly the messages this product exists to
 * handle.
 */
function assertUsable(message: BetaMessage, what: 'responder' | 'judge'): void {
	if (message.stop_reason === 'refusal') {
		throw new CheckinModelRefusal(
			`The ${what} call was declined by a safety classifier`,
			what,
			message.stop_details?.type === 'refusal' ? (message.stop_details.category ?? null) : null
		);
	}
	if (message.stop_reason === 'max_tokens') {
		// Not a refusal, but equally not a usable answer: a half-written message
		// to a family is worse than none, and a half-written draft would be
		// reviewed as though it were complete.
		throw new CheckinModelRefusal(`The ${what} call hit its output limit`, what, 'max_tokens');
	}
}

function parseChecks(input: unknown): ObjectiveCheck[] {
	if (!input || typeof input !== 'object' || !('checks' in input)) return [];
	const checks = (input as { checks: unknown }).checks;
	if (!Array.isArray(checks)) return [];

	// Narrowed field by field rather than cast. The shape is guaranteed by the
	// tool schema, which means it is guaranteed by a service — the engine's own
	// `normalizeChecks` then clamps the values, and between the two a malformed
	// rating costs one objective rather than the turn.
	return checks.flatMap((raw): ObjectiveCheck[] => {
		if (!raw || typeof raw !== 'object') return [];
		const check = raw as Record<string, unknown>;
		if (typeof check.objective !== 'string') return [];
		return [
			{
				objective: check.objective,
				rating: typeof check.rating === 'number' ? check.rating : 0,
				confidence: typeof check.confidence === 'number' ? check.confidence : 0,
				answer: typeof check.answer === 'string' ? check.answer : null
			}
		];
	});
}

/**
 * The live client. Constructed per action invocation rather than at module
 * scope so a deployment with no key configured still loads.
 */
export function anthropicCheckinModel(): CheckinModel {
	const client = new Anthropic({ apiKey: anthropicApiKey() });

	return {
		async respond(request: ResponderRequest): Promise<ResponderResult> {
			const startedAt = Date.now();
			const model = responderModel();
			const message = await client.beta.messages.create({
				model,
				max_tokens: RESPONDER_MAX_TOKENS,
				...fallbackParams(model),
				system: request.system,
				messages: [{ role: 'user', content: request.user }],
				// `medium` rather than the default: writing two warm sentences to a
				// family is not a reasoning-heavy task, and the effort budget is
				// better spent on the drafting call than on every ask.
				output_config: { effort: 'medium' },
				...(request.tools.length > 0
					? {
							tools: request.tools as unknown as BetaToolUnion[],
							// AUTO, never forced. §3.2. A forced `draft_update` would
							// manufacture a draft out of a conversation the model did not
							// think was draftable, which is the one thing a human reviewer
							// would have no way to notice.
							tool_choice: { type: 'auto' as const }
						}
					: {})
			});
			assertUsable(message, 'responder');

			const draft = toolInput(message, 'draft_update');
			return {
				model: message.model,
				text: textFrom(message),
				draft:
					draft && typeof draft === 'object'
						? {
								title: String((draft as Record<string, unknown>).title ?? '').trim(),
								body: String((draft as Record<string, unknown>).body ?? '').trim()
							}
						: null,
				latencyMs: Date.now() - startedAt,
				inputTokens: message.usage.input_tokens,
				outputTokens: message.usage.output_tokens
			};
		},

		async judge(request: JudgeRequest): Promise<JudgeResult> {
			const startedAt = Date.now();
			const judge = judgeModel();
			const message = await client.beta.messages.create({
				model: judge,
				max_tokens: JUDGE_MAX_TOKENS,
				...fallbackParams(judge),
				system: request.system,
				messages: [{ role: 'user', content: request.user }],
				tools: [request.tool] as unknown as BetaToolUnion[],
				// FORCED. The judge has exactly one way to answer, so there is no
				// path where it returns prose the caller then has to parse.
				tool_choice: { type: 'tool' as const, name: request.tool.name },
				// `low` EXPLICITLY, because the default is `high` and this call does
				// not want it: the judge reads a few sentences and fills four fields
				// behind a forced tool call. Left unset it would spend Sonnet's full
				// effort budget on the highest-frequency call in the system for no
				// better a rating.
				//
				// Still no `thinking`. On this tier omitting it means none, which is
				// what a forced tool call wants.
				output_config: { effort: 'low' as const }
			});
			assertUsable(message, 'judge');

			const input = toolInput(message, request.tool.name);
			if (input === null) {
				throw new CheckinModelRefusal('The judge did not return a rating', 'judge', 'no_tool_call');
			}

			return {
				model: message.model,
				checks: parseChecks(input),
				latencyMs: Date.now() - startedAt,
				inputTokens: message.usage.input_tokens,
				outputTokens: message.usage.output_tokens
			};
		}
	};
}
