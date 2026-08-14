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
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { requireCapability } from '../model/access';
import {
	activePromptVersions,
	deleteConversationCascade,
	familyChildFacts,
	isCheckin,
	recordInboundMessage,
	requireConversation
} from '../model/checkins';
import { defaultObjectivesForFamily } from '../../lib/domain/checkin-objectives';
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

		await requireNoOpenConversation(ctx, { projectId: project._id, contactId: args.contactId });

		const prompts = await activePromptVersions(ctx, orgId);
		const facts = await familyChildFacts(ctx, project);

		const conversationId = await ctx.db.insert('checkinConversations', {
			orgId,
			campaignId: project.campaignId,
			projectId: project._id,
			contactId: args.contactId,
			kind: 'checkin' as const,
			status: 'open' as const,
			objectives: defaultObjectivesForFamily(facts),
			responderPromptVersion: prompts.responder.version,
			drafterPromptVersion: prompts.drafter.version,
			judgePromptVersion: prompts.judge.version,
			locale: args.locale?.trim() || 'en',
			turnsSpent: 0,
			openedAt: args.now,
			// Stamped at open, not left until the first message: the inbox sorts on
			// it, and a conversation that has just been started is the one most
			// likely to be looked at next.
			lastMessageAt: args.now
		});

		// The opening message is a model call, so it happens in an action. Nothing
		// is sent from a mutation.
		await ctx.scheduler.runAfter(0, internal.checkins.engine.advanceTurn, { conversationId });
		return conversationId;
	}
});

/**
 * Refuses when this record already has a conversation somebody could still be
 * replying to. Both open paths use it, so the rule cannot hold on one and not
 * the other.
 */
async function requireNoOpenConversation(
	ctx: MutationCtx,
	target: { projectId?: Id<'projects'>; contactId?: Id<'contacts'> }
): Promise<void> {
	if (target.projectId) {
		const open = await ctx.db
			.query('checkinConversations')
			.withIndex('by_projectId_and_status', (q) =>
				q.eq('projectId', target.projectId).eq('status', 'open')
			)
			.first();
		if (open) throw new ConvexError('This record already has a conversation in progress');
	}

	if (target.contactId) {
		// By person as well as by record, because the thing being protected is a
		// phone: two open threads with the same sponsor is two sets of messages
		// arriving from the same charity, whether or not a record is involved.
		const open = await ctx.db
			.query('checkinConversations')
			.withIndex('by_contactId', (q) => q.eq('contactId', target.contactId))
			.take(50);
		if (open.some((conversation) => conversation.status === 'open')) {
			throw new ConvexError('This person already has a conversation in progress');
		}
	}
}

/**
 * Open a plain conversation with a family. No model, no objectives, no
 * prompts — people talking.
 *
 * The whole difference from `startCheckin` is what it does NOT do: it freezes
 * no prompt versions, snapshots no objective set, and schedules no turn. A
 * conversation that later needs the engine gets it through
 * `startCheckinOnConversation` below, which is what makes "message a family,
 * then run a check-in on that same thread" one transcript rather than two.
 */
export const startConversation = mutation({
	args: {
		campaignId: v.id('campaigns'),
		// At least one of these. A record for a family conversation, a person for
		// a sponsor or an attendee, or both when you know which member of a
		// household holds the phone.
		projectId: v.optional(v.id('projects')),
		contactId: v.optional(v.id('contacts')),
		locale: v.optional(v.string()),
		now: v.number()
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write', args.campaignId);

		if (!args.projectId && !args.contactId) {
			throw new ConvexError('A conversation needs someone to be with');
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) throw new ConvexError('Campaign not found');

		if (args.projectId) {
			const project = await ctx.db.get('projects', args.projectId);
			if (!project || project.orgId !== orgId) throw new ConvexError('Record not found');
			// Checked rather than trusted: `campaignId` is carried on the row and a
			// record from another campaign would put this conversation in a feed
			// nobody meant to put it in.
			if (project.campaignId !== args.campaignId) {
				throw new ConvexError('That record belongs to a different campaign');
			}
		}

		if (args.contactId) {
			const contact = await ctx.db.get('contacts', args.contactId);
			if (!contact || contact.orgId !== orgId) throw new ConvexError('Contact not found');
		}

		await requireNoOpenConversation(ctx, {
			projectId: args.projectId,
			contactId: args.contactId
		});

		return await ctx.db.insert('checkinConversations', {
			orgId,
			campaignId: args.campaignId,
			projectId: args.projectId,
			contactId: args.contactId,
			kind: 'direct' as const,
			status: 'open' as const,
			locale: args.locale?.trim() || 'en',
			turnsSpent: 0,
			openedAt: args.now,
			lastMessageAt: args.now
		});
	}
});

/**
 * A staff member writes to the family.
 *
 * Stamped with `authorUserId` so the transcript can say who wrote it. The
 * engine's own messages carry none, and that difference is what stops a person
 * reading this later from attributing a model's sentence to a colleague.
 *
 * Nothing is delivered — the transport is still out of scope (§6). This queues
 * the words and records that a person chose them.
 */
export const sendMessage = mutation({
	args: {
		conversationId: v.id('checkinConversations'),
		text: v.string(),
		now: v.number()
	},
	handler: async (ctx, args) => {
		const { orgId, userId } = await requireCapability(ctx, 'projects:write');
		const conversation = await requireConversation(ctx, orgId, args.conversationId);
		await requireCapability(ctx, 'projects:write', conversation.campaignId);

		const text = args.text.trim();
		if (!text) throw new ConvexError('A message needs text');

		// Refused on a live check-in, and this is the one place in the feature
		// that refuses rather than storing. A person typing into a conversation
		// the engine is mid-turn on produces a transcript where the family was
		// asked two different questions at once, and the judge then rates the
		// reply against whichever it happens to read. Close the check-in, or wait
		// for it to hand over.
		if (isCheckin(conversation) && conversation.status === 'open') {
			throw new ConvexError(
				'A check-in is running on this conversation. Close it before writing yourself.'
			);
		}

		await ctx.db.insert('checkinMessages', {
			orgId,
			conversationId: conversation._id,
			direction: 'outbound' as const,
			text,
			authorUserId: userId,
			turnNumber: conversation.turnsSpent,
			at: args.now
		});

		await ctx.db.patch('checkinConversations', conversation._id, { lastMessageAt: args.now });
		return conversation._id;
	}
});

/**
 * Hand an existing conversation to the engine.
 *
 * The objective set and the three prompt versions are frozen HERE rather than
 * at open, because this is the moment the conversation becomes a check-in —
 * and freezing them any earlier would bind a thread that was only ever people
 * talking to a prompt version that has since been replaced.
 *
 * Everything already said stays in the transcript and the responder reads it.
 * That is the point of one table: a check-in started on a thread where a
 * coordinator already said "we will be in touch about school" must not open by
 * asking about school as though nobody had spoken.
 */
export const startCheckinOnConversation = mutation({
	args: { conversationId: v.id('checkinConversations'), now: v.number() },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const conversation = await requireConversation(ctx, orgId, args.conversationId);
		await requireCapability(ctx, 'projects:write', conversation.campaignId);

		if (isCheckin(conversation)) {
			throw new ConvexError('This conversation is already a check-in');
		}
		if (conversation.status !== 'open') {
			throw new ConvexError('This conversation is closed');
		}
		// The engine's objectives are about a household and its profile is built
		// from a record, so a conversation with a sponsor has nothing for it to
		// work on. Messaging anyone in the campaign is general; running a family
		// check-in is not.
		if (!conversation.projectId) {
			throw new ConvexError('A check-in needs a record. This conversation is with a person.');
		}

		const project = await ctx.db.get('projects', conversation.projectId);
		if (!project || project.orgId !== orgId) throw new ConvexError('Record not found');

		const prompts = await activePromptVersions(ctx, orgId);
		const facts = await familyChildFacts(ctx, project);

		await ctx.db.patch('checkinConversations', conversation._id, {
			kind: 'checkin' as const,
			objectives: defaultObjectivesForFamily(facts),
			responderPromptVersion: prompts.responder.version,
			drafterPromptVersion: prompts.drafter.version,
			judgePromptVersion: prompts.judge.version
		});

		await ctx.scheduler.runAfter(0, internal.checkins.engine.advanceTurn, {
			conversationId: conversation._id
		});
		return conversation._id;
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

		// Every decision lives in `recordInboundMessage` — the scan, the
		// escalation rows, and whether a turn is scheduled. This mutation's job is
		// the capability check above it.
		return await recordInboundMessage(ctx, conversation, text, args.now);
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
