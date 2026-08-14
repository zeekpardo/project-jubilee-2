// ============================================================
// Starting a check-in, feeding it a reply, and stopping it
// ============================================================
// Gated twice per model/access.ts, like every other write in this codebase:
// once org-wide to establish the caller, then again with the row's own
// `campaignId` once it has been read.
//
// WHICH CAPABILITY, AND WHY.
//
//   start / receive / escalate  — `projects:write`. A check-in is work on a
//     record, the same as writing its story or ticking its checklist, and the
//     team leader who visits this family is exactly who should be able to
//     start one and exactly who should see what came back.
//   prompts                     — `settings:manage`. Editing the words a
//     machine says to a family on the charity's behalf is an org-level
//     decision, not a per-campaign one.
//   delete                      — `campaign:edit`. Deleting a conversation
//     deletes the audit trail behind a published post, so it sits with the
//     seniority that runs the campaign rather than with the field team.
//
// PUBLISHING APPEARS NOWHERE HERE. The only thing a check-in can put in front
// of the public is an `updates` draft, and it goes out through the existing
// `publishUpdate`, behind `content:publish`, read by someone who is not the
// person who ran the check-in. §2 and §3.4.
// ============================================================

import { ConvexError, v } from 'convex/values';
import { mutation } from '../functions';
import { internal } from '../_generated/api';
import { requireCapability } from '../model/access';
import {
	activePromptVersions,
	deleteConversationCascade,
	familyChildFacts,
	requireConversation
} from '../model/checkins';
import { defaultObjectivesForFamily } from '../../lib/domain/checkin-objectives';
import { escalationExcerpt, scanForEscalation } from '../../lib/domain/checkin-escalation';
import { SHIPPED_PROMPT_VERSIONS } from '../../lib/domain/checkin-prompts';

/**
 * Insert every prompt version this build ships, and make each the active one
 * for its role if the org has none.
 *
 * Idempotent by version string, and APPEND-ONLY: a version that already exists
 * is left exactly as it is, never patched to match the source. That is the
 * whole contract — the file in the repo is the current draft, the row in the
 * table is what a conversation was actually run against, and when they differ
 * the row wins. Editing a live prompt is done by adding `responder-2`.
 */
export const seedPromptVersions = mutation({
	args: { model: v.string() },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');

		let inserted = 0;
		for (const prompt of SHIPPED_PROMPT_VERSIONS) {
			const existing = await ctx.db
				.query('promptVersions')
				.withIndex('by_orgId_and_version', (q) =>
					q.eq('orgId', orgId).eq('version', prompt.version)
				)
				.first();
			if (existing) continue;

			const active = await ctx.db
				.query('promptVersions')
				.withIndex('by_orgId_and_role_and_isActive', (q) =>
					q.eq('orgId', orgId).eq('role', prompt.role).eq('isActive', true)
				)
				.first();

			await ctx.db.insert('promptVersions', {
				orgId,
				role: prompt.role,
				version: prompt.version,
				content: prompt.content,
				model: args.model,
				isActive: !active,
				notes: 'Seeded from the shipped prompt set'
			});
			inserted += 1;
		}
		return inserted;
	}
});

/**
 * Add a new prompt version. There is no update mutation and there never will
 * be — see PLAN-ai-checkin.md §2.
 */
export const createPromptVersion = mutation({
	args: {
		role: v.union(v.literal('responder'), v.literal('drafter'), v.literal('judge')),
		version: v.string(),
		content: v.string(),
		model: v.string(),
		notes: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');

		const version = args.version.trim();
		if (!version) throw new ConvexError('A prompt version needs a version name');
		if (!args.content.trim()) throw new ConvexError('A prompt version needs content');

		const clash = await ctx.db
			.query('promptVersions')
			.withIndex('by_orgId_and_version', (q) => q.eq('orgId', orgId).eq('version', version))
			.first();
		if (clash) throw new ConvexError(`Prompt version ${version} already exists`);

		// Inserted INACTIVE. Writing a new prompt and putting it in front of
		// families are two decisions, and §5 says the second one comes after
		// replaying real logged conversations against it.
		return await ctx.db.insert('promptVersions', {
			orgId,
			role: args.role,
			version,
			content: args.content,
			model: args.model,
			isActive: false,
			notes: args.notes
		});
	}
});

/** Promote a version. Exactly one active per (org, role), enforced here. */
export const activatePromptVersion = mutation({
	args: { promptVersionId: v.id('promptVersions') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');

		const prompt = await ctx.db.get('promptVersions', args.promptVersionId);
		if (!prompt || prompt.orgId !== orgId) throw new ConvexError('Prompt version not found');

		const others = await ctx.db
			.query('promptVersions')
			.withIndex('by_orgId_and_role_and_isActive', (q) =>
				q.eq('orgId', orgId).eq('role', prompt.role).eq('isActive', true)
			)
			.take(20);
		for (const other of others) {
			if (other._id === prompt._id) continue;
			await ctx.db.patch('promptVersions', other._id, { isActive: false });
		}

		// Conversations already open keep the version they froze at open — they
		// name it on their own row, and nothing here reads back through this table
		// to find it. A family does not get a different voice mid-conversation
		// because an admin promoted a prompt while they were typing.
		await ctx.db.patch('promptVersions', prompt._id, { isActive: true });
		return prompt._id;
	}
});

/**
 * Open a check-in with one family and send the first message.
 *
 * The objective set and the three prompt versions are FROZEN onto the row here.
 * Both are snapshots for the same reason `budgets` snapshot a cost template:
 * the log is also the replay set, and a conversation whose objectives or
 * wording could change underneath it is not replayable.
 */
export const startCheckin = mutation({
	args: {
		projectId: v.id('projects'),
		contactId: v.optional(v.id('contacts')),
		locale: v.optional(v.string()),
		now: v.number()
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');

		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== orgId) throw new ConvexError('Record not found');
		// The campaign is only knowable after the load, so the real gate is here.
		await requireCapability(ctx, 'projects:write', project.campaignId);

		if (args.contactId) {
			const contact = await ctx.db.get('contacts', args.contactId);
			if (!contact || contact.orgId !== orgId) throw new ConvexError('Contact not found');
		}

		// One open conversation per family. Two would produce two sets of
		// questions arriving on the same phone from the same charity, and a
		// judge rating each half of a split reply.
		const open = await ctx.db
			.query('checkinConversations')
			.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
			.take(50);
		if (open.some((conversation) => conversation.status === 'open')) {
			throw new ConvexError('This family already has a check-in in progress');
		}

		const prompts = await activePromptVersions(ctx, orgId);
		const facts = await familyChildFacts(ctx, project);

		const conversationId = await ctx.db.insert('checkinConversations', {
			orgId,
			campaignId: project.campaignId,
			projectId: project._id,
			contactId: args.contactId,
			status: 'open' as const,
			objectives: defaultObjectivesForFamily(facts),
			responderPromptVersion: prompts.responder.version,
			drafterPromptVersion: prompts.drafter.version,
			judgePromptVersion: prompts.judge.version,
			locale: args.locale?.trim() || 'en',
			turnsSpent: 0,
			openedAt: args.now
		});

		// The opening message is a model call, so it happens in an action. Nothing
		// is sent from a mutation.
		await ctx.scheduler.runAfter(0, internal.checkins.engine.advanceTurn, { conversationId });
		return conversationId;
	}
});

/**
 * A message arrived from the family.
 *
 * THE ESCALATION SCAN RUNS HERE, in the mutation, before anything is scheduled
 * — §3.3's "immediate, deterministic handoff, independent of and prior to
 * normal objective processing", made literal. A message that trips it is
 * stored, raises escalation rows, closes the conversation to the machine, and
 * never reaches a model. There is no ordering in which a model sees it first,
 * because the model call does not exist yet at this point in the code.
 */
export const receiveMessage = mutation({
	args: {
		conversationId: v.id('checkinConversations'),
		text: v.string(),
		now: v.number()
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const conversation = await requireConversation(ctx, orgId, args.conversationId);
		await requireCapability(ctx, 'projects:write', conversation.campaignId);

		const text = args.text.trim();
		if (!text) throw new ConvexError('An incoming message needs text');

		// STORED FIRST, unconditionally, whatever state the conversation is in.
		// A family that keeps writing after an escalation is a family still
		// saying things, and refusing the write would drop exactly the messages
		// most worth keeping. What a non-`open` conversation does not get, below,
		// is another model call.
		const turnNumber = conversation.turnsSpent + 1;
		await ctx.db.insert('checkinMessages', {
			orgId,
			conversationId: conversation._id,
			direction: 'inbound' as const,
			text,
			turnNumber,
			at: args.now
		});

		const scan = scanForEscalation(text);
		if (scan.escalated) {
			for (const match of scan.matches) {
				await ctx.db.insert('checkinEscalations', {
					orgId,
					conversationId: conversation._id,
					projectId: conversation.projectId,
					campaignId: conversation.campaignId,
					turnNumber,
					category: match.category,
					term: match.term,
					excerpt: escalationExcerpt(text, match),
					status: 'open' as const
				});
			}
			await ctx.db.patch('checkinConversations', conversation._id, {
				status: 'escalated' as const,
				lastMessageAt: args.now,
				closedAt: args.now
			});
			return { escalated: true, matches: scan.matches.length };
		}

		// A reply to a conversation a person already took over is stored — it is
		// still something the family said — but does not restart the machine.
		if (conversation.status !== 'open') {
			await ctx.db.patch('checkinConversations', conversation._id, { lastMessageAt: args.now });
			return { escalated: false, matches: 0 };
		}

		await ctx.scheduler.runAfter(0, internal.checkins.engine.advanceTurn, {
			conversationId: conversation._id
		});
		return { escalated: false, matches: 0 };
	}
});

/** A person has seen an escalation. Not the same as having dealt with it. */
export const acknowledgeEscalation = mutation({
	args: { escalationId: v.id('checkinEscalations'), now: v.number() },
	handler: async (ctx, args) => {
		const { orgId, userId } = await requireCapability(ctx, 'projects:write');
		const escalation = await ctx.db.get('checkinEscalations', args.escalationId);
		if (!escalation || escalation.orgId !== orgId) throw new ConvexError('Escalation not found');
		await requireCapability(ctx, 'projects:write', escalation.campaignId);

		await ctx.db.patch('checkinEscalations', escalation._id, {
			status: 'acknowledged' as const,
			acknowledgedBy: userId,
			acknowledgedAt: args.now
		});
		return escalation._id;
	}
});

/**
 * Close one out. `note` is where what actually happened gets written, and it is
 * the only prose this feature stores that a person wrote rather than a model.
 */
export const resolveEscalation = mutation({
	args: {
		escalationId: v.id('checkinEscalations'),
		note: v.optional(v.string()),
		now: v.number()
	},
	handler: async (ctx, args) => {
		const { orgId, userId } = await requireCapability(ctx, 'projects:write');
		const escalation = await ctx.db.get('checkinEscalations', args.escalationId);
		if (!escalation || escalation.orgId !== orgId) throw new ConvexError('Escalation not found');
		await requireCapability(ctx, 'projects:write', escalation.campaignId);

		await ctx.db.patch('checkinEscalations', escalation._id, {
			status: 'resolved' as const,
			resolvedBy: userId,
			resolvedAt: args.now,
			note: args.note?.trim() || escalation.note
		});
		return escalation._id;
	}
});

/**
 * A person has finished with a conversation the machine handed them.
 *
 * Deliberately one-way: there is no reopen. A conversation that a person picked
 * up has had things said in it that the engine's state does not know about, and
 * handing it back to the machine to continue from a transcript that no longer
 * reflects reality is how a bot asks a family about school three days after a
 * staff member visited them.
 */
export const closeCheckin = mutation({
	args: { conversationId: v.id('checkinConversations'), now: v.number() },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const conversation = await requireConversation(ctx, orgId, args.conversationId);
		await requireCapability(ctx, 'projects:write', conversation.campaignId);

		await ctx.db.patch('checkinConversations', conversation._id, {
			status: 'closed' as const,
			closedAt: args.now
		});
		return conversation._id;
	}
});

/**
 * Delete a conversation and its trace.
 *
 * A heavier capability than the rest of this file on purpose: this is the audit
 * trail behind a post that may already be public, and §4 exists so that trail
 * can be produced later. The draft survives with its link cleared — see
 * `deleteConversationCascade`.
 */
export const deleteCheckin = mutation({
	args: { conversationId: v.id('checkinConversations') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const conversation = await requireConversation(ctx, orgId, args.conversationId);
		await requireCapability(ctx, 'campaign:edit', conversation.campaignId);

		await deleteConversationCascade(ctx, conversation._id);
		return null;
	}
});
