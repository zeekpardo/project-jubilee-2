/**
 * The Anthropic secret and the two model choices, read once and guarded at the
 * point of use.
 *
 * Same convention as `stripe/env.ts`, and for the same reason: Convex's typed
 * env API does not exist on the version this repo is pinned to, so these are
 * read at module scope and throw where they are needed rather than at import —
 * a missing key should fail the one action that needed it, not take down the
 * deployment.
 *
 * `ANTHROPIC_API_KEY` lives in Convex deployment env only
 * (`npx convex env set`). There is no publishable counterpart: nothing about
 * this feature runs in a browser, and a key that reached one would be a key
 * anyone could spend.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CHECKIN_RESPONDER_MODEL = process.env.CHECKIN_RESPONDER_MODEL;
const CHECKIN_JUDGE_MODEL = process.env.CHECKIN_JUDGE_MODEL;

export function anthropicApiKey(): string {
	if (!ANTHROPIC_API_KEY) {
		throw new Error('ANTHROPIC_API_KEY environment variable is required but not set');
	}
	return ANTHROPIC_API_KEY;
}

/**
 * The model that writes to the family.
 *
 * PLAN-ai-checkin.md §7 leaves the tier open pending real volume, so this is an
 * env override with a deliberate default rather than a hardcode.
 *
 * Sonnet 4.6 by choice. The job is two warm sentences to a family, not hard
 * reasoning — the thinking in this system happens in `decideNext`, in code,
 * where it can be tested. Note the tier difference that follows: omitting the
 * `thinking` parameter means NO thinking on Sonnet 4.6, where on the Opus 5
 * this replaced it would have meant adaptive. That is the intended behaviour
 * here and it is a real change, not a detail.
 *
 * Sonnet also has no published server-side fallback chain, so refusal
 * fallbacks switch themselves off — see FALLBACK_CAPABLE in client.ts. A
 * refusal on this tier surfaces as a handoff to a person rather than being
 * re-served by another model.
 */
export function responderModel(): string {
	return CHECKIN_RESPONDER_MODEL?.trim() || 'claude-sonnet-4-6';
}

/**
 * The rater. Haiku-tier per §3.2: it sees a handful of sentences and a list of
 * objective descriptions, returns four numbers and four short strings through a
 * forced tool call, and runs on every incoming message.
 */
export function judgeModel(): string {
	return CHECKIN_JUDGE_MODEL?.trim() || 'claude-haiku-4-5';
}

/**
 * Whether check-ins are configured at all, without throwing.
 *
 * The admin surface asks this so an unconfigured deployment renders "not
 * connected" rather than an error — the same shape `isLivemode()` has in
 * `stripe/env.ts`.
 */
export function checkinsConfigured(): boolean {
	return Boolean(ANTHROPIC_API_KEY);
}
