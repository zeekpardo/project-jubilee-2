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
 * env override with a deliberate default rather than a hardcode. The default is
 * the top tier because the responder's failure mode is not "a worse sentence" —
 * it is a clumsy message to a family in a fragile situation, and that is not
 * where this system should be economising first. The judge below is where the
 * volume is and where the cheap model belongs.
 */
export function responderModel(): string {
	return CHECKIN_RESPONDER_MODEL?.trim() || 'claude-opus-5';
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
