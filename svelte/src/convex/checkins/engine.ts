'use node';

// ============================================================
// The one function in this feature that spends money
// ============================================================
// Read context, run `advanceCheckin`, commit what came back. Everything
// interesting is in `lib/domain/checkin-engine.ts`, which this file supplies a
// real Anthropic client to; the golden-set tests supply a scripted one and
// exercise the same code path with no key and no network.
//
// `'use node'` because the Anthropic SDK expects a Node runtime. Nothing here
// exports a query or a mutation — those live in the sibling files, in the
// default runtime, where the rest of the app can reach them.
//
// An action is not a transaction. That is why the context arrives from ONE
// internal query and the result goes back through ONE internal mutation: the
// two ends of this function are each atomic, and the model call in between is
// the only part that can fail halfway.
// ============================================================

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { advanceCheckin } from '../../lib/domain/checkin-engine';
import { anthropicCheckinModel, CheckinModelRefusal } from './client';
import { judgeModel, responderModel } from './env';

/**
 * Advance one conversation by one turn.
 *
 * Scheduled by `receiveMessage` and `startCheckin`, never called from a client.
 * Takes no message argument: the message it is about was already written to
 * `checkinMessages` by the mutation that scheduled this, so a retry re-reads
 * the same state instead of processing a message twice.
 */
export const advanceTurn = internalAction({
	args: { conversationId: v.id('checkinConversations') },
	handler: async (ctx, args) => {
		const context = await ctx.runQuery(internal.checkins.internal.loadTurnContext, {
			conversationId: args.conversationId
		});
		if (!context) return null;

		// A conversation a person has taken over, or one that already finished,
		// does not get another model call because a stale scheduled job fired.
		if (context.status !== 'open') return null;

		const turnNumber = context.turnsSpent + 1;

		try {
			const advance = await advanceCheckin(
				{
					objectives: context.objectives,
					priorChecks: context.priorChecks,
					messages: context.messages,
					incoming: context.incoming,
					turnsSpent: context.turnsSpent,
					profile: context.profile,
					publicFirstName: context.publicFirstName,
					prompts: context.prompts
				},
				anthropicCheckinModel()
			);

			// The escalation path cannot be reached from here in practice —
			// `receiveMessage` scans before it schedules, so an escalating message
			// never gets a turn. It is handled anyway because "the check that must
			// always run" having exactly one call site is how it eventually gets
			// moved, and a silent fall-through would be the failure this whole
			// design exists to prevent.
			if (advance.decision.kind === 'escalated') {
				await ctx.runMutation(internal.checkins.internal.failTurn, {
					conversationId: args.conversationId,
					turnNumber,
					role: 'judge' as const,
					promptVersion: context.prompts.judge.version,
					model: judgeModel(),
					error: 'Escalation detected during the turn; handed to a person',
					needsReview: true,
					now: Date.now()
				});
				return null;
			}

			await ctx.runMutation(internal.checkins.internal.commitTurn, {
				conversationId: args.conversationId,
				turnNumber,
				records: advance.records,
				checks: advance.checks,
				decision:
					advance.decision.kind === 'review'
						? { kind: 'review' as const, reason: advance.decision.reason }
						: advance.decision.kind === 'draft'
							? { kind: 'draft' as const }
							: { kind: 'ask' as const },
				outbound: advance.outbound,
				draft: advance.draft,
				now: Date.now()
			});
			return null;
		} catch (error) {
			// A refusal, a truncation, or a forced tool call that did not happen.
			// All three mean this conversation needs a person rather than a retry:
			// the model declined to engage with what a family said, and the correct
			// response to that is not to ask it again more loudly.
			const refused = error instanceof CheckinModelRefusal;
			await ctx.runMutation(internal.checkins.internal.failTurn, {
				conversationId: args.conversationId,
				turnNumber,
				role: 'responder' as const,
				promptVersion: context.prompts.responder.version,
				model: responderModel(),
				error: error instanceof Error ? error.message : String(error),
				needsReview: refused,
				now: Date.now()
			});

			// Anything that is NOT a refusal — a timeout, a 529, a network blip — is
			// rethrown so Convex records the action as failed and it stays visible.
			// The conversation is left `open`, which is what makes re-running this
			// action the whole recovery procedure.
			if (!refused) throw error;
			return null;
		}
	}
});
