// ============================================================
// What a check-in is trying to find out, and when it has found it out
// ============================================================
// A check-in is not a conversation with a topic. It is a fixed set of
// OBJECTIVES, each of which is either answered or not, and the conversation
// ends when none are outstanding. That is the whole control structure — see
// PLAN-ai-checkin.md §3.1.
//
// Pure — no db, no framework, no network — for the same reason
// lib/domain/permissions.ts is: these rules decide whether an AI conversation
// with a freed family keeps going or hands off to a person, and that decision
// has to be exercisable in a test file with no deployment and no API key.
//
// SNAPSHOTTING. The objective SET is copied onto the conversation when it
// opens, not read from this file at judge time — the same contract `budgets`
// keep with `costTemplates`. Rewording an objective must not retroactively
// change what a logged conversation was asking, because the log is also the
// replay set (§4), and a replay against a moved goalpost proves nothing.
// ============================================================

/**
 * One thing a check-in wants to know.
 *
 * `description` is the ONLY text the judge sees about this objective — no
 * family profile, no history beyond the recent turns (§3.2). So it has to be
 * self-contained and has to describe what a satisfying ANSWER looks like, not
 * what question to ask.
 */
export interface CheckinObjective {
	key: string;
	/** Admin-facing. Never sent to a model. */
	label: string;
	description: string;

	// ---- Everything below is optional, and absent means "use the constant".
	// These exist because the objective set is now authored by the org rather
	// than shipped in this file (see workflows.ts), and an author who
	// can write the question needs to be able to say how strictly it is marked.
	// They are carried on the SNAPSHOT, not read from the template at judge
	// time, for the same reason the wording is: a threshold changed mid-flight
	// would re-grade a conversation that was already scored.

	/** Per-objective override of RATING_ANSWERED. */
	minRating?: number;
	/** Per-objective override of CONFIDENCE_ACCEPT. */
	minConfidence?: number;
	/**
	 * How many turns this objective may be rated before we stop asking it.
	 * Absent = no per-objective limit; MAX_RESPONDER_TURNS still bounds the
	 * conversation as a whole.
	 */
	maxAttempts?: number;
	/** What to do with the answer once it is accepted. Absent = capture only. */
	capture?: CheckinCapture;
}

/**
 * What happens to an objective's answer once the judge accepts it.
 *
 * `none` is the honest default and the common case: most of what a check-in
 * learns is prose for a human to read, not a value to file. `field` is the
 * other half of what makes this an agent builder rather than a questionnaire —
 * the answer lands on the record.
 *
 * The write is deliberately NOT modelled as a tool the responder can call.
 * A tool call is a thing the model decides to do; this is a thing the engine
 * does when a rating clears the bar, which means it is bounded by the same
 * threshold everything else is and shows up in the same decision trace.
 */
export type CheckinCapture =
	| { kind: 'none' }
	| {
			kind: 'field';
			/** Which record the value lands on. */
			entity: 'project' | 'contact';
			/** A customFieldDefinitions key on that entity. */
			fieldKey: string;
			/**
			 * Allowed values. When set, an answer that is not one of them is not
			 * written — a picklist that accepts free text is not a picklist.
			 */
			options?: string[];
	  };

/**
 * The four objectives every check-in starts from. Free-keyed rather than a
 * union type because §3.1 says the set is extendable per family, and a union
 * would make "ask the Rahman family about the new business" a schema change.
 */
export const DEFAULT_CHECKIN_OBJECTIVES: CheckinObjective[] = [
	{
		key: 'job_status',
		label: 'Work',
		description:
			'Whether the adults in the family are working, what work they are doing, and whether that work is steady. A satisfying answer names the work or says plainly that nobody is working yet.'
	},
	{
		key: 'school_status',
		label: 'School',
		description:
			'Whether the school-age children are enrolled and attending. A satisfying answer says whether they are going, and if not, why not. Silence about school is not an answer.'
	},
	{
		key: 'kids_update',
		label: 'Children',
		description:
			'How the children are doing generally — health, growth, anything the family wants to share about them. A satisfying answer says something specific about at least one child.'
	},
	{
		key: 'general_wellbeing',
		label: 'Wellbeing',
		description:
			'How the family is doing overall: housing, health, money, spirits. A satisfying answer goes past a bare greeting and says something about how life is going.'
	}
];

/**
 * The objective set for one family, given what the record already knows about
 * it. PLAN-ai-checkin.md §7 leaves "does every family get the same four" open;
 * this is the answer this code ships with, and it is deliberately the smallest
 * rule that is not obviously wrong: do not ask a family without children how
 * their children are.
 *
 * Asking anyway is not a harmless extra question. It is a machine that was
 * told about this family asking after children who are not there, which is the
 * kind of thing that ends a family's willingness to answer at all.
 */
export function defaultObjectivesForFamily(facts: {
	hasChildren: boolean;
	hasSchoolAgeChildren: boolean;
}): CheckinObjective[] {
	return DEFAULT_CHECKIN_OBJECTIVES.filter((objective) => {
		if (objective.key === 'kids_update') return facts.hasChildren;
		if (objective.key === 'school_status') return facts.hasSchoolAgeChildren;
		return true;
	});
}

/**
 * One objective's rating for one turn, exactly as the judge's `rate_objectives`
 * tool returns it.
 *
 * `answer` is NULLABLE and that is the load-bearing part: forced tool use
 * guarantees the shape of what comes back, not the truth of it, so the schema
 * has to give the model somewhere to put "they have not said" other than a
 * plausible sentence. See PLAN-ai-checkin.md §3.2.
 */
export interface ObjectiveCheck {
	objective: string;
	/** 0..1 — how completely this turn's conversation answers the objective. */
	rating: number;
	answer: string | null;
	/** 0..1 — how sure the judge is of its own reading. */
	confidence: number;
}

/**
 * Below this, the objective is simply not answered yet and gets asked again.
 */
export const RATING_ANSWERED = 0.7;

/**
 * Above the rating bar but below this, the family HAS answered and we are not
 * sure we read them correctly. That is a different failure from silence and
 * gets a different destination: a person, not another question.
 */
export const CONFIDENCE_ACCEPT = 0.7;

/**
 * How many responder turns a single check-in may spend before it stops asking.
 *
 * A cap rather than a timeout because the transport is asynchronous and out of
 * scope (§6): "no reply for a week" is a fact the transport knows and this
 * engine does not. What this engine can bound is how many times it is willing
 * to ask, and a family that has been asked six times and answered nothing is a
 * family a person should be calling, not a bot.
 */
export const MAX_RESPONDER_TURNS = 6;

export type ObjectiveState = 'unanswered' | 'needs_review' | 'answered';

/**
 * What one rating means, before any other rating is considered.
 *
 * `answer === null` short-circuits everything. A null answer with a high rating
 * is an internally inconsistent result — the judge rated an objective answered
 * and then declined to say what the answer was — and the safe reading of a
 * contradiction is that nothing was answered.
 */
export function classifyCheck(
	check: ObjectiveCheck,
	/**
	 * The objective this rating is for, when the caller has it. Only its
	 * thresholds are read. Optional so the existing single-argument calls and
	 * the golden-set tests keep working against the constants.
	 */
	objective?: Pick<CheckinObjective, 'minRating' | 'minConfidence'>
): ObjectiveState {
	const minRating = objective?.minRating ?? RATING_ANSWERED;
	const minConfidence = objective?.minConfidence ?? CONFIDENCE_ACCEPT;

	if (check.answer === null) return 'unanswered';
	if (!(check.rating >= minRating)) return 'unanswered';
	if (!(check.confidence >= minConfidence)) return 'needs_review';
	return 'answered';
}

/**
 * How many times this objective has been put to the family.
 *
 * Counted from the ratings rather than stored in a column, and that is exact
 * rather than approximate: the judge prompt says "rate every objective you are
 * given, including ones the messages say nothing about", so a judge call
 * produces exactly one check per outstanding objective. One row is one turn it
 * was in play. A stored counter would be a second source of truth for a fact
 * the decision trace already holds.
 */
export function attemptsFor(objectiveKey: string, checks: ObjectiveCheck[]): number {
	return checks.filter((check) => check.objective === objectiveKey).length;
}

/** Ranked worst-first, so `bestState` can take a max. */
const STATE_RANK: Record<ObjectiveState, number> = {
	unanswered: 0,
	needs_review: 1,
	answered: 2
};

/**
 * The best any turn has managed for each objective.
 *
 * BEST, not latest, and that is deliberate: a family answers the school
 * question in turn two and then talks about the weather in turn three, and the
 * judge — which only sees recent turns — rates school unanswered in turn
 * three. Taking the latest rating would re-ask a question the family already
 * answered, which is how an automated check-in becomes something people stop
 * replying to.
 */
export function bestStates(
	objectives: CheckinObjective[],
	checks: ObjectiveCheck[]
): Map<string, ObjectiveState> {
	const states = new Map<string, ObjectiveState>();
	const byKey = new Map<string, CheckinObjective>();
	for (const objective of objectives) {
		states.set(objective.key, 'unanswered');
		byKey.set(objective.key, objective);
	}

	for (const check of checks) {
		// A rating for an objective this conversation is not pursuing is ignored
		// rather than trusted — the objective set is snapshotted on the
		// conversation, and a key outside it came from somewhere else.
		if (!states.has(check.objective)) continue;
		const state = classifyCheck(check, byKey.get(check.objective));
		if (STATE_RANK[state] > STATE_RANK[states.get(check.objective)!]) {
			states.set(check.objective, state);
		}
	}
	return states;
}

/**
 * What the model should do next, decided here rather than in a prompt.
 *
 * Everything downstream of a check-in — asking again, handing to a person,
 * drafting a post about a named family — branches on this value, so it is a
 * value and not an inference. A prompt that decides when to stop is a prompt
 * that decides, some fraction of the time, to keep going.
 */
export type CheckinDecision =
	| { kind: 'escalated' }
	| { kind: 'ask'; objectives: CheckinObjective[] }
	| { kind: 'review'; reason: CheckinReviewReason; objectives: CheckinObjective[] }
	| { kind: 'draft' };

/**
 * Why a conversation stopped short of a draft. Three different things a person
 * is being asked to do, so they are three values rather than one flag:
 *
 *   low_confidence — the family answered and we are unsure we read them right.
 *   exhausted      — we asked as often as we are willing to and never got there.
 *   draft_failed   — everything was answered, and the drafting call did not
 *                    come back with a draft.
 *   model_error    — a call was declined by a safety classifier, or came back
 *                    truncated or empty.
 *
 * The last two are set by the engine and the action respectively, never by
 * `decideNext`: they are facts about a model call rather than about the state
 * of the objectives.
 */
export type CheckinReviewReason = 'low_confidence' | 'exhausted' | 'draft_failed' | 'model_error';

export function decideNext(input: {
	objectives: CheckinObjective[];
	checks: ObjectiveCheck[];
	/** Responder calls already made in this conversation. */
	turnsSpent: number;
	escalated: boolean;
}): CheckinDecision {
	// Escalation outranks every other state, including "we have everything we
	// need". A family that has just disclosed danger does not get a cheerful
	// closing message, and does not get a blog draft. §3.3.
	if (input.escalated) return { kind: 'escalated' };

	const states = bestStates(input.objectives, input.checks);

	// An objective is only still worth asking if it has attempts left. `spent`
	// is the ones an author capped and we have now asked as often as they
	// allowed — the per-objective sibling of MAX_RESPONDER_TURNS, and it exists
	// because a family who will not answer one question should not cost us the
	// three they would have answered.
	const unanswered = input.objectives.filter((o) => states.get(o.key) === 'unanswered');
	const spent = unanswered.filter(
		(o) => o.maxAttempts !== undefined && attemptsFor(o.key, input.checks) >= o.maxAttempts
	);
	const outstanding = unanswered.filter((o) => !spent.includes(o));
	const uncertain = input.objectives.filter((o) => states.get(o.key) === 'needs_review');

	if (outstanding.length > 0) {
		// Out of turns with questions still open. Not a failure to report and not
		// something to draft from — it is a family a person should follow up with,
		// which is the same destination a low-confidence answer gets.
		if (input.turnsSpent >= MAX_RESPONDER_TURNS) {
			return { kind: 'review', reason: 'exhausted', objectives: outstanding };
		}
		return { kind: 'ask', objectives: outstanding };
	}

	// Answered, but at least one reading we do not trust. Deliberately NOT
	// re-asked: the family did answer, and asking again would be the machine
	// telling them it did not understand — which is a cost paid by the family to
	// resolve a problem that is ours. A person reads the transcript instead.
	if (uncertain.length > 0) {
		return { kind: 'review', reason: 'low_confidence', objectives: uncertain };
	}

	// Nothing left to ask, but something was given up on. Deliberately NOT a
	// draft: an objective that ran out of attempts is a question the family
	// never answered, and drafting over it would produce a confident-looking
	// post whose gap nobody was told about. Same destination and same reason as
	// running out of conversation-wide turns, because it is the same failure at
	// a different scope.
	if (spent.length > 0) {
		return { kind: 'review', reason: 'exhausted', objectives: spent };
	}

	return { kind: 'draft' };
}
