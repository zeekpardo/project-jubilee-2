// ============================================================
// Check-ins: loading state, writing the trace, and stopping
// ============================================================
// The decisions live in lib/domain/checkin-*.ts, which have no database in
// them. This file is everything that does: reading a conversation's state back
// out of the log, assembling the one string a model is allowed to know about a
// family, and writing what a turn produced.
//
// THE PRIVACY LINE RUNS THROUGH `buildFamilyProfile` BELOW. It is the only
// function that turns a record into text a model sees, and it is deliberately
// short. Everything the platform spends its privacy budget protecting —
// custom fields, medical notes, the ledger, the village — is absent because it
// was never fetched, not because a prompt asked for restraint.
// ============================================================

import { ConvexError } from 'convex/values';
import { internal } from '../_generated/api';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { escalationExcerpt, scanForEscalation } from '../../lib/domain/checkin-escalation';
import type { CheckinMessage } from '../../lib/domain/checkin-prompts';
import type { CheckinObjective, ObjectiveCheck } from '../../lib/domain/checkin-objectives';

/**
 * The `updates.authorUserId` a machine-written draft carries.
 *
 * Not a real Better Auth id and never will be: it resolves to nobody, so the
 * post renders as unattributed rather than as written by whoever triggered the
 * check-in. Putting a staff member's name on prose they have not read is how a
 * reviewer comes to trust a draft they should be interrogating.
 */
export const AI_AUTHOR_USER_ID = 'ai:checkin';

/**
 * The most `input`/`output` characters one logged turn may store.
 *
 * A responder context is a family profile plus a WhatsApp conversation, which
 * is a few thousand characters — nowhere near Convex's 1MB document limit. The
 * cap exists for the case that is not that: a pasted wall of text, a runaway
 * prompt, a future objective set nobody bounded. Truncating loses the tail of
 * one log row; failing the write loses the whole row, and the row is the only
 * record of what the model was asked.
 */
const MAX_LOGGED_CHARS = 60_000;

export function truncateForLog(text: string): string {
	if (text.length <= MAX_LOGGED_CHARS) return text;
	return `${text.slice(0, MAX_LOGGED_CHARS)}\n…[truncated ${text.length - MAX_LOGGED_CHARS} characters]`;
}

/** A conversation in the caller's org, or a hard failure. */
export async function requireConversation(
	ctx: QueryCtx,
	orgId: string,
	conversationId: Id<'checkinConversations'>
): Promise<Doc<'checkinConversations'>> {
	const conversation = await ctx.db.get('checkinConversations', conversationId);
	if (!conversation || conversation.orgId !== orgId) {
		throw new ConvexError('Check-in not found');
	}
	return conversation;
}

/** The most messages or checks any one read of a conversation returns. */
const CONVERSATION_PAGE_MAX = 200;

/**
 * The transcript, oldest first.
 *
 * Read from `checkinMessages` rather than reconstructed from the prompts in
 * `conversationTurns` — see the schema comment on that table for why parsing a
 * prompt to recover what someone said is a trap.
 */
export async function conversationMessages(
	ctx: QueryCtx,
	conversationId: Id<'checkinConversations'>
): Promise<CheckinMessage[]> {
	const rows = await ctx.db
		.query('checkinMessages')
		.withIndex('by_conversationId_and_at', (q) => q.eq('conversationId', conversationId))
		.take(CONVERSATION_PAGE_MAX);

	return rows.map((row) => ({
		role: row.direction === 'outbound' ? ('assistant' as const) : ('family' as const),
		text: row.text
	}));
}

/** Every rating logged for this conversation so far. */
export async function conversationChecks(
	ctx: QueryCtx,
	conversationId: Id<'checkinConversations'>
): Promise<ObjectiveCheck[]> {
	const rows = await ctx.db
		.query('objectiveChecks')
		.withIndex('by_conversationId', (q) => q.eq('conversationId', conversationId))
		.take(CONVERSATION_PAGE_MAX);

	return rows.map((row) => ({
		objective: row.objective,
		rating: row.rating,
		answer: row.answer,
		confidence: row.confidence
	}));
}

/**
 * Everything a model may be told about this family, as one string.
 *
 * The responder is writing TO the family, so their own names are not a
 * disclosure — the person reading the message already knows them. What is
 * deliberately absent is everything that would be a disclosure if the message
 * went astray or the transcript were ever mishandled: the village, the
 * employer, the debt, the stage, the custom fields, the medical notes. None of
 * it is fetched here, which is a stronger guarantee than not mentioning it.
 *
 * `publicName` is NOT used. That field is what an admin decided the PUBLIC may
 * call this record, and this is not the public — using it here would train the
 * responder to address a family by a name chosen for strangers.
 */
export async function buildFamilyProfile(
	ctx: QueryCtx,
	project: Doc<'projects'>,
	contactId: Id<'contacts'> | undefined
): Promise<string> {
	const campaign = await ctx.db.get('campaigns', project.campaignId);
	const lines: string[] = [];

	// WHO IS WRITING. Without this the responder has no name for the charity and
	// fills the gap itself — a live run opened with "Hi Grace, it's [Name] from
	// [Charity]", which is what a family would have received. The prompt forbids
	// placeholders now too; this is the half that makes obeying it possible.
	const settings = await ctx.db
		.query('orgSettings')
		.withIndex('by_orgId', (q) => q.eq('orgId', project.orgId))
		.first();
	if (settings?.publicName) {
		lines.push(`You are writing on behalf of ${settings.publicName}.`);
	}

	if (contactId) {
		const contact = await ctx.db.get('contacts', contactId);
		if (contact && contact.orgId === project.orgId) {
			lines.push(`You are messaging ${contact.firstName}.`);
		}
	}

	// First names and roles of the people on the record, and nothing else about
	// them. `side: 'team'` members are the organization's own staff and
	// volunteers — they are not this family and must not be described as it.
	const members = await ctx.db
		.query('projectMembers')
		.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
		.take(50);

	const household: string[] = [];
	for (const member of members) {
		if (member.side === 'team') continue;
		const contact = await ctx.db.get('contacts', member.contactId);
		if (!contact || contact.orgId !== project.orgId) continue;
		household.push(contact.child ? `${contact.firstName} (a child)` : contact.firstName);
	}
	if (household.length > 0) {
		lines.push(`The family: ${household.join(', ')}.`);
	}

	if (campaign && project.isGoalMet) {
		lines.push(`They were ${campaign.goalVerb} through this charity's work.`);
	}

	// Empty rather than apologetic. A responder given no profile writes a
	// generic, careful message, which is the correct behaviour for a record
	// nobody has filled in — and better than one confidently addressing a family
	// by details that turned out to be a placeholder.
	return lines.join('\n');
}

/**
 * Whether this family has children, and school-age ones, decided from the
 * record rather than asked of a model.
 *
 * `grade` is Planning Center's numeric scale where -4..12 are all school
 * stages; its presence is the only positive signal this schema has that a child
 * is of school age. A child with no grade recorded counts as school-age, which
 * is the safe direction: asking about school and being told "she is two" costs
 * one message, and never asking loses the objective the campaign exists to
 * report on.
 */
export async function familyChildFacts(
	ctx: QueryCtx,
	project: Doc<'projects'>
): Promise<{ hasChildren: boolean; hasSchoolAgeChildren: boolean }> {
	const members = await ctx.db
		.query('projectMembers')
		.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
		.take(50);

	let hasChildren = false;
	let hasSchoolAgeChildren = false;
	for (const member of members) {
		if (member.side === 'team') continue;
		const contact = await ctx.db.get('contacts', member.contactId);
		if (!contact || contact.orgId !== project.orgId || !contact.child) continue;
		hasChildren = true;
		if (contact.grade === undefined || contact.grade >= -4) hasSchoolAgeChildren = true;
	}
	return { hasChildren, hasSchoolAgeChildren };
}

/**
 * The prompt versions a new conversation binds itself to.
 *
 * Read once at open and then frozen onto the conversation, so promoting a new
 * responder mid-conversation cannot change the voice halfway through — the
 * family would notice, and the log would stop being replayable as one unit.
 */
export async function activePromptVersions(
	ctx: QueryCtx,
	orgId: string
): Promise<{
	responder: Doc<'promptVersions'>;
	drafter: Doc<'promptVersions'>;
	judge: Doc<'promptVersions'>;
}> {
	const active = async (role: 'responder' | 'drafter' | 'judge') =>
		await ctx.db
			.query('promptVersions')
			.withIndex('by_orgId_and_role_and_isActive', (q) =>
				q.eq('orgId', orgId).eq('role', role).eq('isActive', true)
			)
			.first();

	const [responder, drafter, judge] = await Promise.all([
		active('responder'),
		active('drafter'),
		active('judge')
	]);

	if (!responder || !drafter || !judge) {
		throw new ConvexError(
			'This organization has no active check-in prompts. Seed them before opening a check-in.'
		);
	}
	return { responder, drafter, judge };
}

/** A prompt by version, for the frozen versions a conversation names. */
export async function promptByVersion(
	ctx: QueryCtx,
	orgId: string,
	version: string
): Promise<Doc<'promptVersions'>> {
	const prompt = await ctx.db
		.query('promptVersions')
		.withIndex('by_orgId_and_version', (q) => q.eq('orgId', orgId).eq('version', version))
		.first();
	if (!prompt) {
		throw new ConvexError(`Prompt version ${version} not found`);
	}
	return prompt;
}

/** True when the engine owns this conversation. Absent `kind` means it does. */
export function isCheckin(conversation: Doc<'checkinConversations'>): boolean {
	return (conversation.kind ?? 'checkin') === 'checkin';
}

/**
 * Turn the stored objective set back into the domain shape. A plain map today,
 * and the one place to widen if the stored shape ever gains a field the engine
 * should not see.
 */
export function storedObjectives(conversation: Doc<'checkinConversations'>): CheckinObjective[] {
	// A `direct` conversation has none — it is people talking, not a check-in
	// working through a list.
	return (conversation.objectives ?? []).map((objective) => ({
		key: objective.key,
		label: objective.label,
		description: objective.description
	}));
}

/**
 * Delete a conversation and everything hanging off it.
 *
 * The draft is NOT deleted with it — a post somebody may still want to publish
 * survives, with its link cleared, the same way `deleteProjectCascade` clears
 * an allocation's `projectId` rather than losing the money. Escalations DO go:
 * an escalation is a pointer into a transcript, and a pointer to a transcript
 * that no longer exists is not a safety record, it is a dead row in a queue.
 */
export async function deleteConversationCascade(
	ctx: MutationCtx,
	conversationId: Id<'checkinConversations'>
): Promise<void> {
	// Every child table here is bounded by MAX_RESPONDER_TURNS: at most a
	// handful of messages, two model calls per turn, and one rating per
	// objective per turn. `CONVERSATION_PAGE_MAX` is an order of magnitude above
	// the ceiling, so a single page is the whole conversation.
	for (const table of ['checkinMessages', 'conversationTurns', 'objectiveChecks'] as const) {
		const rows = await ctx.db
			.query(table)
			.withIndex('by_conversationId', (q) => q.eq('conversationId', conversationId))
			.take(CONVERSATION_PAGE_MAX);
		for (const row of rows) await ctx.db.delete(table, row._id);
	}

	const escalations = await ctx.db
		.query('checkinEscalations')
		.withIndex('by_conversationId', (q) => q.eq('conversationId', conversationId))
		.take(CONVERSATION_PAGE_MAX);
	for (const escalation of escalations) {
		await ctx.db.delete('checkinEscalations', escalation._id);
	}

	// The draft is reached through the conversation's own `updateId` rather than
	// by scanning `updates` for a back-reference: the column is optional and has
	// no index, so a scan here would read every post in the org to clear at most
	// one link.
	const conversation = await ctx.db.get('checkinConversations', conversationId);
	if (conversation?.updateId) {
		const draft = await ctx.db.get('updates', conversation.updateId);
		if (draft) {
			await ctx.db.patch('updates', draft._id, { checkinConversationId: undefined });
		}
	}

	await ctx.db.delete('checkinConversations', conversationId);
}

/** Every conversation attached to a record, for the project cascade. */
export async function deleteProjectCheckins(
	ctx: MutationCtx,
	projectId: Id<'projects'>
): Promise<void> {
	const conversations = await ctx.db
		.query('checkinConversations')
		.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
		.take(100);
	for (const conversation of conversations) {
		await deleteConversationCascade(ctx, conversation._id);
	}
}

/**
 * Record a message that arrived from the other side, and decide what happens
 * next.
 *
 * ONE IMPLEMENTATION, deliberately. `receiveMessage` calls it and so does the
 * sandbox harness, because the rule it encodes — scan before anything else,
 * and never hand an escalating message to a model — is the rule this whole
 * design exists to guarantee. A second copy of it in a dev-only path is a
 * second copy that can drift, and the one that drifts is the one nobody reads.
 *
 * The caller has already established who is asking. This does the work.
 */
export async function recordInboundMessage(
	ctx: MutationCtx,
	conversation: Doc<'checkinConversations'>,
	text: string,
	now: number
): Promise<{ escalated: boolean; matches: number }> {
	const turnNumber = conversation.turnsSpent + 1;

	// Stored first, unconditionally, whatever state the conversation is in. A
	// family that keeps writing after an escalation is a family still saying
	// things, and refusing the write would drop exactly the messages most worth
	// keeping.
	await ctx.db.insert('checkinMessages', {
		orgId: conversation.orgId,
		conversationId: conversation._id,
		direction: 'inbound' as const,
		text,
		turnNumber,
		at: now
	});

	const scan = scanForEscalation(text);
	if (scan.escalated) {
		for (const match of scan.matches) {
			await ctx.db.insert('checkinEscalations', {
				orgId: conversation.orgId,
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
			lastMessageAt: now,
			closedAt: now
		});
		return { escalated: true, matches: scan.matches.length };
	}

	// A reply on a DIRECT conversation is the whole point of one — stored,
	// scanned, and no model called. The same is true of a check-in a person
	// already took over.
	if (!isCheckin(conversation) || conversation.status !== 'open') {
		await ctx.db.patch('checkinConversations', conversation._id, { lastMessageAt: now });
		return { escalated: false, matches: 0 };
	}

	await ctx.scheduler.runAfter(0, internal.checkins.engine.advanceTurn, {
		conversationId: conversation._id
	});
	return { escalated: false, matches: 0 };
}
