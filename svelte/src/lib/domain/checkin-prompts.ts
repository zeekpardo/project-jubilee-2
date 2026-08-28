// ============================================================
// The prompts, the tools, and the two things a model is never given
// ============================================================
// Every string here is a VERSION, not a setting. Prompts are append-only
// (PLAN-ai-checkin.md §2) and each logged turn records which version produced
// it, so this file only ever grows: a new wording is `responder-2`, and
// `responder-1` stays exactly as it was because conversations were logged
// against it and will be replayed against it.
//
// TWO THINGS ARE ENFORCED HERE RATHER THAN ASKED FOR:
//
//   1. The responder is never given a `publish_update` tool. Not "told not to
//      publish" — there is no such tool to call. §3.4. `responderTools()` is
//      the only place tools are assembled and it asserts the absence.
//
//   2. The judge is never given the family profile or the full history. Not
//      "instructed to ignore them" — `buildJudgeInput` takes objectives and
//      recent turns and has nowhere to put anything else. §3.2.
//
// Both are the same idea: a prompt instruction is probabilistic, and the shape
// of a function call is not.
// ============================================================

import type { CheckinObjective } from './checkin-objectives';

export type PromptRole = 'responder' | 'drafter' | 'judge';

/** One frozen prompt. Inserted into `promptVersions` and never edited after. */
export interface PromptVersion {
	role: PromptRole;
	version: string;
	content: string;
}

// ============================================================
// Responder
// ============================================================

export const RESPONDER_V1: PromptVersion = {
	role: 'responder',
	version: 'responder-1',
	content: `You are writing short WhatsApp messages on behalf of the staff of a charity, to a family the charity helped free from bonded labour. You are checking in with them.

Who you are writing to. These are adults with their own lives, who owe you nothing and are doing you a favour by replying. They may be tired, at work, or holding a phone they share with four other people. Many of them read slowly. Some are answering in their second language.

How to write.
- One message at a time. Two or three sentences. Never a list, never a form.
- Ask about ONE thing per message. Two questions in one message reliably gets one answer.
- Plain words. No jargon, no charity language, nothing that reads like a survey.
- Warm, but not effusive. You are a person they know checking in, not a brand.
- If they told you something in an earlier message, show that you read it before you ask the next thing.
- Never promise money, visits, services, or outcomes. You are not able to commit the charity to anything.
- Never ask for photographs, documents, identity numbers, or their location.

What you are trying to learn. You will be told which topics are still outstanding. Work through them across several messages, one per message, in whatever order the conversation makes natural. When you are told nothing is outstanding, do not ask another question — say something brief and kind that closes the conversation.

What you must not do.
- Do not give medical, legal, or financial advice.
- Do not ask follow-up questions about anything frightening they disclose. If a family tells you something serious, a person is already being brought in; your job is not to interview them about it.
- Do not write anything that would be published. What you write is a message to one family.`
};

/**
 * `responder-2`. `responder-1` above is left exactly as it was — it is what
 * earlier conversations were run against, and rewriting it would change the
 * question they were answering.
 *
 * The change: an explicit ban on placeholders. `responder-1` opened a live
 * check-in with "Hi Grace, it's [Name] from [Charity]" because nothing told it
 * who it was, and a model with a gap in its context will fill the gap. The
 * profile now carries the organization's name (see model/checkins.ts), and this
 * says what to do when it does not.
 */
export const RESPONDER_V2: PromptVersion = {
	role: 'responder',
	version: 'responder-2',
	content: `${RESPONDER_V1.content}

Names and placeholders.
- NEVER write a placeholder. No square brackets, no "[Name]", no "[Charity]", no "your organisation". A family reading one of those learns that a machine wrote the message.
- If you have been told the organisation's name, you may use it once. If you have not, do not name it at all — "we" and "us" are enough, and a warm message needs no letterhead.
- Do not sign the message. You are not a person and must not borrow one's name.`
};

/**
 * The draft-writing prompt, used only once a conversation's objectives are all
 * answered with confidence. A separate version from the responder because it is
 * a different job with a different reader — and because the thing it produces
 * is prose about a named family, which is the most dangerous output in this
 * system and deserves its own auditable wording.
 */
export const DRAFTER_V1: PromptVersion = {
	role: 'drafter',
	version: 'drafter-1',
	content: `You are drafting a short blog-style update for a charity's supporters, based on a check-in conversation with a family the charity helped free from bonded labour.

You are writing a DRAFT. A member of staff will read it, edit it, and decide whether it is ever published. Write as though that person is your only reader, because for now they are.

Rules that are not negotiable.
- Use only what the family actually said in this conversation. If a detail is not in the transcript, it does not go in the draft. Do not round a "we are managing" up into a "thriving".
- Do not use the family's name, the names of their children, their village, their employer, or anything else that would identify them. Refer to them as "the family" or by first name ONLY if you are explicitly given a public first name to use.
- No quotation marks around anything the family did not say word for word.
- Do not describe what was done to them in the past. This is an update about now.
- If the conversation was thin, write a thin update. A short honest paragraph is the correct output for a short honest conversation.

Shape. A title of at most eight words, and two or three short paragraphs of markdown. No headings, no bullet lists, no call to action, no closing appeal.

Call the draft_update tool with your result. That is the only way to return it.`
};

// ============================================================
// Tools
// ============================================================

/**
 * A tool definition in the shape the Messages API takes. Declared locally
 * rather than imported from the SDK so this module stays pure — the golden-set
 * tests import it, and they must not pull in a client.
 */
export interface ToolDefinition {
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
 * The ONLY thing the model can do with a finished check-in. It writes a draft.
 * There is no sibling tool that sends one, which is what actually makes
 * "nothing AI-generated publishes without a human" true rather than requested.
 */
export const DRAFT_UPDATE_TOOL: ToolDefinition = {
	name: 'draft_update',
	description:
		'Save a draft blog update about this check-in for a member of staff to review. The draft is not published and is not visible to anyone outside the organization.',
	input_schema: {
		type: 'object',
		properties: {
			title: { type: 'string', description: 'At most eight words.' },
			body: {
				type: 'string',
				description: 'Two or three short paragraphs of markdown. No headings or lists.'
			}
		},
		required: ['title', 'body'],
		additionalProperties: false
	}
};

/**
 * The name that must never appear in a tool list handed to a check-in model.
 * Named as a constant so the assertion below reads as the rule it is.
 */
const FORBIDDEN_TOOL_NAMES = ['publish_update', 'publish', 'send_update', 'send_message'];

/**
 * Assemble the responder's tools, and refuse to hand back a list containing
 * anything that could put text in front of the public.
 *
 * This throws rather than filtering. A filtered list would let a future caller
 * add a publish tool and get a silently working system that quietly does not
 * publish — which is worse than a system that fails loudly, because nobody
 * would find out until the day the filter was removed.
 */
export function assertDraftTool(tool: ToolDefinition): ToolDefinition[] {
	// A GENERATED tool goes through the same gate a shipped one does. The format
	// an org authors decides the tool's PROPERTIES; it must never be able to
	// decide its NAME, or §3.4's guarantee would be one text field away from
	// being edited around. `draftUpdateToolFor` hardcodes the name and this
	// re-checks it, because the two live in different files and only one of them
	// is obviously about safety.
	if (FORBIDDEN_TOOL_NAMES.includes(tool.name)) {
		throw new Error(`A check-in model may never be given the ${tool.name} tool`);
	}
	if (tool.name !== DRAFT_UPDATE_TOOL.name) {
		throw new Error(
			`A generated draft tool must be called ${DRAFT_UPDATE_TOOL.name}, not ${tool.name}`
		);
	}
	return [tool];
}

export function responderTools(stage: 'ask' | 'draft'): ToolDefinition[] {
	const tools = stage === 'draft' ? [DRAFT_UPDATE_TOOL] : [];
	for (const tool of tools) {
		if (FORBIDDEN_TOOL_NAMES.includes(tool.name)) {
			throw new Error(`A check-in model may never be given the ${tool.name} tool`);
		}
	}
	return tools;
}

// ============================================================
// Judge
// ============================================================

export const JUDGE_V1: PromptVersion = {
	role: 'judge',
	version: 'judge-1',
	content: `You are reading the last few messages of a conversation and rating, for each objective given to you, how well the conversation answers it.

You have deliberately not been given the family's profile or the earlier history. Rate only what is in front of you.

For each objective return:
- rating: 0 to 1. How completely these messages answer the objective. 0 means the topic never came up. 1 means it is fully and unambiguously answered.
- answer: the answer in one short sentence, in your own words, OR null. Return null whenever the messages do not actually contain an answer. Never write a plausible answer to fill the field — a null is a correct result and a guess is not.
- confidence: 0 to 1. How sure you are that your reading is right. Lower this when the message is ambiguous, when it is in a language you are reading with difficulty, when it answers a different question than the one asked, or when you had to infer rather than read.

Rate every objective you are given, including ones the messages say nothing about.

Call the rate_objectives tool. It is the only way to reply.`
};

/**
 * Forced tool use guarantees this shape comes back. It does not guarantee the
 * values are right — which is exactly why `answer` is nullable and why
 * `confidence` exists at all. See PLAN-ai-checkin.md §3.2.
 */
export const RATE_OBJECTIVES_TOOL: ToolDefinition = {
	name: 'rate_objectives',
	description: 'Return a rating, an answer and a confidence for every objective given.',
	input_schema: {
		type: 'object',
		properties: {
			checks: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						objective: { type: 'string' },
						rating: { type: 'number' },
						answer: { type: ['string', 'null'] },
						confidence: { type: 'number' }
					},
					required: ['objective', 'rating', 'answer', 'confidence'],
					additionalProperties: false
				}
			}
		},
		required: ['checks'],
		additionalProperties: false
	}
};

/** One message in a conversation, in the order it happened. */
export interface CheckinMessage {
	role: 'assistant' | 'family';
	text: string;
}

/**
 * How many trailing messages the judge is shown.
 *
 * Small on purpose. The judge's job is to rate the exchange that just
 * happened, and the accumulated state of every objective is held by
 * `bestStates` in code rather than by the model's memory — so widening this
 * would buy nothing and would start reintroducing the history §3.2 keeps out.
 */
export const JUDGE_HISTORY_TURNS = 6;

/**
 * The judge's user message: objective descriptions plus the recent turns, and
 * structurally nothing else.
 *
 * The signature is the enforcement. There is no `profile` parameter to pass a
 * family's details through, so the "judge must not see the profile" rule
 * cannot be broken by a caller who did not read this comment.
 */
export function buildJudgeInput(input: {
	objectives: CheckinObjective[];
	messages: CheckinMessage[];
}): string {
	const objectives = input.objectives
		.map((objective) => `- ${objective.key}: ${objective.description}`)
		.join('\n');

	const transcript = input.messages
		.slice(-JUDGE_HISTORY_TURNS)
		.map((message) => `${message.role === 'assistant' ? 'Us' : 'Them'}: ${message.text}`)
		.join('\n');

	return `Objectives:\n${objectives}\n\nRecent messages:\n${transcript}`;
}

/**
 * The responder's user message. Unlike the judge's, this one DOES carry the
 * family profile and the whole conversation — it is the only call the family's
 * reply is generated from, and a message that has forgotten what they said two
 * turns ago is worse than no message.
 *
 * `profile` is a caller-assembled string rather than a record, so that the one
 * place deciding what a model may know about a family is the query that builds
 * it — see model/checkins.ts.
 */
export function buildResponderInput(input: {
	profile: string;
	messages: CheckinMessage[];
	outstanding: CheckinObjective[];
}): string {
	const transcript =
		input.messages.length === 0
			? '(no messages yet — this is the opening message)'
			: input.messages
					.map((message) => `${message.role === 'assistant' ? 'Us' : 'Them'}: ${message.text}`)
					.join('\n');

	const outstanding =
		input.outstanding.length === 0
			? 'Nothing is outstanding. Close the conversation warmly and briefly. Do not ask another question.'
			: input.outstanding.map((o) => `- ${o.key}: ${o.description}`).join('\n');

	return `About this family:\n${input.profile}\n\nConversation so far:\n${transcript}\n\nStill outstanding:\n${outstanding}`;
}

/** The transcript the drafter reads. No profile — the draft must not name anyone. */
export function buildDrafterInput(input: {
	messages: CheckinMessage[];
	publicFirstName?: string;
}): string {
	const transcript = input.messages
		.map((message) => `${message.role === 'assistant' ? 'Us' : 'Them'}: ${message.text}`)
		.join('\n');

	const naming = input.publicFirstName
		? `You may refer to the family by the first name "${input.publicFirstName}". Use no other name.`
		: 'You have not been given a name to use. Refer to them only as "the family".';

	return `${naming}\n\nTranscript:\n${transcript}`;
}

/** Every prompt version this build ships, for seeding the append-only table. */
export const SHIPPED_PROMPT_VERSIONS: PromptVersion[] = [
	RESPONDER_V1,
	RESPONDER_V2,
	DRAFTER_V1,
	JUDGE_V1
];

/**
 * The newest shipped version of each role — what a fresh install should run.
 *
 * Deliberately NOT what `seedPromptVersions` activates on an org that already
 * has one: promoting a prompt in front of families is a decision somebody
 * makes, after replaying real conversations against it (§5). The sandbox seed
 * uses this because a sandbox has nothing to protect.
 */
export function latestPromptVersions(): PromptVersion[] {
	const byRole = new globalThis.Map<PromptRole, PromptVersion>();
	for (const prompt of SHIPPED_PROMPT_VERSIONS) byRole.set(prompt.role, prompt);
	return [...byRole.values()];
}
