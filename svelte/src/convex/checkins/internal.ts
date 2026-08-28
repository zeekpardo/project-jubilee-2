// ============================================================
// What the turn action reads, and what it writes back
// ============================================================
// A model call cannot happen inside a transaction, so one turn is three
// functions: an internal query that gathers the context, an action that spends
// the money, and an internal mutation that commits everything the action came
// back with in ONE transaction.
//
// The commit being a single mutation is the point. A turn produces a
// transcript line, two log rows, four ratings, a status change and sometimes a
// draft, and a half-applied turn — ratings written, status not — is a
// conversation that re-asks a question it already has the answer to, or worse,
// a draft with no trace of what produced it.
//
// Everything here is `internalMutation`/`internalQuery`. None of it is reachable
// from a browser: the public surface is `mutations.ts`, which gates on
// capabilities first.
// ============================================================

import { v } from 'convex/values';
// `internalMutation` comes from `../functions` — the trigger-wrapped builder —
// because that file's rule is about which mutations MAY write the ledger, not
// which ones do; using the raw builder here would make a later write from this
// path silently skip the triggers. `internalQuery` has no wrapped counterpart
// and comes from the generated module.
import { internalMutation } from '../functions';
import { internalQuery, type MutationCtx, type QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import {
	AI_AUTHOR_USER_ID,
	buildFamilyProfile,
	conversationChecks,
	conversationMessages,
	promptByVersion,
	storedObjectives,
	truncateForLog,
	updateFormatByVersion
} from '../model/checkins';
import { validateAttributes } from '../model/customFields';
import {
	bestStates,
	classifyCheck,
	type CheckinObjective,
	type ObjectiveState
} from '../../lib/domain/checkin-objectives';
import { captureValueFor, type UpdateFormat } from '../../lib/domain/checkin-templates';
import type { CheckinMessage } from '../../lib/domain/checkin-prompts';
import type { ObjectiveCheck } from '../../lib/domain/checkin-objectives';

/** The shape the action hands back, mirroring `CheckinAdvance`. */
const turnRecordValidator = v.object({
	role: v.union(v.literal('responder'), v.literal('judge')),
	promptVersion: v.string(),
	model: v.string(),
	input: v.string(),
	output: v.string(),
	latencyMs: v.number(),
	inputTokens: v.optional(v.number()),
	outputTokens: v.optional(v.number())
});

const objectiveCheckValidator = v.object({
	objective: v.string(),
	rating: v.number(),
	answer: v.union(v.string(), v.null()),
	confidence: v.number()
});

/**
 * Everything one turn needs, in one read.
 *
 * One query rather than several because a query is a transaction: the
 * objectives, the ratings and the turn count that the engine's stopping rule
 * compares against all have to come from the same instant, or a concurrent turn
 * can produce a conversation that asks a fifth question after its fourth
 * answered everything.
 */
export const loadTurnContext = internalQuery({
	args: { conversationId: v.id('checkinConversations') },
	handler: async (ctx, args) => {
		const conversation = await ctx.db.get('checkinConversations', args.conversationId);
		if (!conversation) return null;

		// No record means no check-in — see the schema note on `projectId`. The
		// engine has nothing to build a profile from, so the turn does not happen.
		if (!conversation.projectId) return null;
		const project = await ctx.db.get('projects', conversation.projectId);
		if (!project || project.orgId !== conversation.orgId) return null;

		// A `direct` conversation names no prompts and must never reach the engine.
		// Returning null here is the belt to `advanceTurn`'s braces: the only way
		// to schedule a turn is `startCheckin`/`startCheckinOnConversation`, both
		// of which write all three, so a row without them means something else
		// went wrong and the right answer is to do nothing rather than guess at an
		// active version.
		if (
			!conversation.responderPromptVersion ||
			!conversation.drafterPromptVersion ||
			!conversation.judgePromptVersion
		) {
			return null;
		}

		const [responder, drafter, judge] = await Promise.all([
			promptByVersion(ctx, conversation.orgId, conversation.responderPromptVersion),
			promptByVersion(ctx, conversation.orgId, conversation.drafterPromptVersion),
			promptByVersion(ctx, conversation.orgId, conversation.judgePromptVersion)
		]);

		const transcript: CheckinMessage[] = await conversationMessages(ctx, conversation._id);
		const priorChecks: ObjectiveCheck[] = await conversationChecks(ctx, conversation._id);

		// The message this turn is ABOUT is split off the transcript here rather
		// than passed around separately. `receiveMessage` writes an inbound row and
		// then schedules the turn, so "the family's new message" is exactly "the
		// last row, if it is inbound" — and computing it in the same transaction
		// that read the rows is what stops a second message arriving mid-turn from
		// being silently judged as though it were the first.
		const last = transcript[transcript.length - 1];
		const incoming = last?.role === 'family' ? last.text : null;
		const messages = incoming === null ? transcript : transcript.slice(0, -1);

		return {
			status: conversation.status,
			turnsSpent: conversation.turnsSpent,
			objectives: storedObjectives(conversation),
			messages,
			incoming,
			priorChecks,
			profile: await buildFamilyProfile(ctx, project, conversation.contactId),
			// The ONLY name that may reach the drafter, and only if an admin
			// deliberately set one. Absent means the draft names nobody.
			publicFirstName: await resolvePublicFirstName(ctx, conversation),
			prompts: {
				responder: {
					role: 'responder' as const,
					version: responder.version,
					content: responder.content
				},
				drafter: { role: 'drafter' as const, version: drafter.version, content: drafter.content },
				judge: { role: 'judge' as const, version: judge.version, content: judge.content }
			},
			// The shape this conversation's draft was promised, by version rather
			// than by "whatever is active now" — a format promoted mid-conversation
			// must not change the tool the draft is asked for. Undefined when the
			// conversation predates formats or the row has since been removed; the
			// engine falls back to the shipped single-section default, which is the
			// tool it would have been given anyway.
			format: (await resolveFrozenFormat(ctx, conversation)) ?? undefined
		};
	}
});

/**
 * The frozen format for a conversation, in the domain shape.
 *
 * Returns null rather than throwing on a missing row, unlike `promptByVersion`.
 * The difference is deliberate: a missing PROMPT means the conversation cannot
 * be run as it was logged, so stopping is right. A missing FORMAT costs only
 * the section layout, and refusing to advance a live check-in with a family
 * over a cosmetic row would be the wrong trade.
 */
/**
 * Write the answers whose objectives asked to be filed.
 *
 * Goes through `validateAttributes` rather than patching the bag directly, so a
 * captured value is held to exactly the same field definitions a person typing
 * into the record is held to: an unknown key throws, a `select` is coerced to
 * its options, a number that is not one is rejected. A model's answer gets no
 * privileged path into a family's record.
 *
 * Failures here are SWALLOWED, and that is the deliberate trade. This runs
 * inside the transaction that records a turn of a live conversation with a
 * family; a field definition that has since changed type must not be able to
 * roll back the transcript. The write is a convenience on top of an answer that
 * is already logged in `objectiveChecks` either way — the trace survives, and a
 * person can still read what was said.
 */
async function applyCapturedValues(
	ctx: MutationCtx,
	input: {
		conversation: Doc<'checkinConversations'>;
		objectives: CheckinObjective[];
		states: Map<string, ObjectiveState>;
		answers: Map<string, string | null>;
	}
): Promise<void> {
	const projectWrites: Record<string, string> = {};
	const contactWrites: Record<string, string> = {};

	for (const objective of input.objectives) {
		const value = captureValueFor(objective, {
			state: input.states.get(objective.key) ?? 'unanswered',
			answer: input.answers.get(objective.key) ?? null
		});
		if (!value) continue;
		if (value.entity === 'project') projectWrites[value.fieldKey] = value.value;
		else contactWrites[value.fieldKey] = value.value;
	}

	const { conversation } = input;

	if (Object.keys(projectWrites).length > 0 && conversation.projectId) {
		try {
			const project = await ctx.db.get('projects', conversation.projectId);
			if (project) {
				const attributes = await validateAttributes(
					ctx,
					conversation.orgId,
					'project',
					project.campaignId,
					{ ...project.attributes, ...projectWrites }
				);
				await ctx.db.patch('projects', project._id, { attributes });
			}
		} catch {
			// See above: the answer is already in the trace.
		}
	}

	if (Object.keys(contactWrites).length > 0 && conversation.contactId) {
		try {
			const contact = await ctx.db.get('contacts', conversation.contactId);
			if (contact) {
				const customFields = await validateAttributes(
					ctx,
					conversation.orgId,
					'contact',
					null,
					{ ...contact.customFields, ...contactWrites }
				);
				await ctx.db.patch('contacts', contact._id, { customFields });
			}
		} catch {
			// See above.
		}
	}
}

async function resolveFrozenFormat(
	ctx: QueryCtx,
	conversation: Doc<'checkinConversations'>
): Promise<UpdateFormat | null> {
	if (!conversation.updateFormatVersion) return null;
	const row = await updateFormatByVersion(ctx, conversation.orgId, conversation.updateFormatVersion);
	if (!row) return null;
	return {
		version: row.version,
		name: row.name,
		titleGuidance: row.titleGuidance,
		instructions: row.instructions,
		sections: row.sections
	};
}

async function resolvePublicFirstName(
	ctx: QueryCtx,
	conversation: Doc<'checkinConversations'>
): Promise<string | undefined> {
	if (!conversation.contactId) return undefined;
	const contact = await ctx.db.get('contacts', conversation.contactId);
	if (!contact || contact.orgId !== conversation.orgId) return undefined;
	// `publicFirstName`, never `firstName`. The distinction is the whole point of
	// that column: publishing a person's name is an explicit opt-in, not a side
	// effect of having entered it.
	return contact.publicFirstName;
}

/**
 * Commit one completed turn.
 *
 * The status transition is derived from `decision` here rather than passed in
 * as a status, so there is exactly one place that knows a `review` decision
 * means `needs_review` and a `draft` decision means a draft exists.
 */
export const commitTurn = internalMutation({
	args: {
		conversationId: v.id('checkinConversations'),
		turnNumber: v.number(),
		records: v.array(turnRecordValidator),
		checks: v.array(objectiveCheckValidator),
		decision: v.union(
			v.object({ kind: v.literal('ask') }),
			v.object({
				kind: v.literal('review'),
				// The full `CheckinReviewReason` union, including `model_error`, even
				// though the engine never produces that one on this path — `failTurn`
				// does. Narrowing it here would only mean the two ends of the same
				// enum disagree, and the compiler noticing that at the boundary is
				// noise rather than a caught bug.
				reason: v.union(
					v.literal('low_confidence'),
					v.literal('exhausted'),
					v.literal('draft_failed'),
					v.literal('model_error')
				)
			}),
			v.object({ kind: v.literal('draft') })
		),
		outbound: v.union(v.string(), v.null()),
		draft: v.union(v.object({ title: v.string(), body: v.string() }), v.null()),
		now: v.number()
	},
	handler: async (ctx, args) => {
		const conversation = await ctx.db.get('checkinConversations', args.conversationId);
		if (!conversation) return null;

		for (const record of args.records) {
			await ctx.db.insert('conversationTurns', {
				orgId: conversation.orgId,
				conversationId: conversation._id,
				projectId: conversation.projectId,
				turnNumber: args.turnNumber,
				role: record.role,
				promptVersion: record.promptVersion,
				model: record.model,
				input: truncateForLog(record.input),
				output: truncateForLog(record.output),
				latencyMs: record.latencyMs,
				inputTokens: record.inputTokens,
				outputTokens: record.outputTokens
			});
		}

		for (const check of args.checks) {
			await ctx.db.insert('objectiveChecks', {
				orgId: conversation.orgId,
				conversationId: conversation._id,
				turnNumber: args.turnNumber,
				objective: check.objective,
				// Present on every conversation the engine runs — see the guard in
				// `loadTurnContext`. The fallback keeps the write total rather than
				// dropping a rating on a row that should not exist.
				promptVersion: conversation.judgePromptVersion ?? 'unknown',
				rating: check.rating,
				answer: check.answer,
				confidence: check.confidence
			});
		}

		// ---- Captured answers ------------------------------------------------
		//
		// In the SAME transaction that logged the ratings, deliberately: a field
		// written from a reading whose rating landed in a rolled-back turn would
		// be a value on a family's record with no trace of what produced it.
		//
		// `bestStates` rather than this turn's checks alone, because the state
		// that matters is the best any turn managed — the same rule the engine
		// stops on. And `captureValueFor` refuses anything short of `answered`,
		// so a reading routed to a human writes nothing here.
		const objectives = storedObjectives(conversation);
		if (objectives.some((objective) => objective.capture?.kind === 'field')) {
			const allChecks = [...(await conversationChecks(ctx, conversation._id))];
			const states = bestStates(objectives, allChecks);
			const answers = new Map<string, string | null>();
			for (const check of allChecks) {
				const state = classifyCheck(check, objectives.find((o) => o.key === check.objective));
				if (state === 'answered') answers.set(check.objective, check.answer);
			}

			await applyCapturedValues(ctx, {
				conversation,
				objectives,
				states,
				answers
			});
		}


		if (args.outbound !== null) {
			await ctx.db.insert('checkinMessages', {
				orgId: conversation.orgId,
				conversationId: conversation._id,
				direction: 'outbound',
				text: args.outbound,
				turnNumber: args.turnNumber,
				at: args.now
			});
		}

		// The draft. Status is a literal `'draft'` written here, not an argument,
		// and there is no code path in this file that writes `'published'` — the
		// architectural half of "nothing AI-generated publishes without a human"
		// (§3.4). Publishing stays where it already was: `publishUpdate`, behind
		// `content:publish`.
		let updateId: Id<'updates'> | undefined;
		if (args.draft) {
			updateId = await ctx.db.insert('updates', {
				orgId: conversation.orgId,
				campaignId: conversation.campaignId,
				projectId: conversation.projectId,
				title: args.draft.title.trim() || 'Check-in update',
				body: args.draft.body,
				assetIds: [],
				status: 'draft' as const,
				authorUserId: AI_AUTHOR_USER_ID,
				checkinConversationId: conversation._id
			});
		}

		const status =
			args.decision.kind === 'review'
				? ('needs_review' as const)
				: args.decision.kind === 'draft'
					? ('drafted' as const)
					: ('open' as const);

		await ctx.db.patch('checkinConversations', conversation._id, {
			status,
			reviewReason: args.decision.kind === 'review' ? args.decision.reason : undefined,
			// Counted from the records that actually happened, not incremented
			// blindly: a turn where the engine decided not to call the responder did
			// not spend one, and charging it would shorten every conversation that
			// ever needed a person to look at it.
			turnsSpent:
				conversation.turnsSpent + args.records.filter((r) => r.role === 'responder').length,
			lastMessageAt: args.now,
			updateId: updateId ?? conversation.updateId,
			closedAt: status === 'drafted' ? args.now : conversation.closedAt
		});

		return updateId ?? null;
	}
});

/**
 * A turn that threw.
 *
 * The failure is LOGGED as a turn rather than swallowed, because §4's trace has
 * to answer "why did it not respond" as well as "why did it respond that way" —
 * and a conversation that silently stopped is indistinguishable from one nobody
 * started.
 *
 * `needsReview` separates a refusal from a network blip: a refused call is a
 * conversation for a person, a timeout is a turn to run again.
 */
export const failTurn = internalMutation({
	args: {
		conversationId: v.id('checkinConversations'),
		turnNumber: v.number(),
		role: v.union(v.literal('responder'), v.literal('judge')),
		promptVersion: v.string(),
		model: v.string(),
		error: v.string(),
		needsReview: v.boolean(),
		now: v.number()
	},
	handler: async (ctx, args) => {
		const conversation = await ctx.db.get('checkinConversations', args.conversationId);
		if (!conversation) return null;

		await ctx.db.insert('conversationTurns', {
			orgId: conversation.orgId,
			conversationId: conversation._id,
			projectId: conversation.projectId,
			turnNumber: args.turnNumber,
			role: args.role,
			promptVersion: args.promptVersion,
			model: args.model,
			input: '',
			output: '',
			latencyMs: 0,
			error: truncateForLog(args.error)
		});

		if (args.needsReview) {
			await ctx.db.patch('checkinConversations', conversation._id, {
				status: 'needs_review' as const,
				reviewReason: 'model_error' as const,
				lastMessageAt: args.now
			});
		}
		return null;
	}
});
