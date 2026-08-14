// ============================================================
// Reading a check-in, and reading the trace behind it
// ============================================================
// Every query here gates with `readableOrgId`, which returns null rather than
// throwing: a viewer who lost a capability sees an empty queue, not an error
// dialog on every subscription tick. Same contract as the rest of the app.
//
// `getCheckin` deliberately returns the WHOLE trace — transcript, every model
// call with its full input, every rating — because that is what §4 is for. An
// AI conversation with a family that a person cannot read end to end is not
// auditable, and the draft it produced is not reviewable.
// ============================================================

import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { readableOrgId } from '../model/access';
import { bestStates, decideNext, type ObjectiveCheck } from '../../lib/domain/checkin-objectives';
import { checkinsConfigured } from './env';

/** The ratings, in the shape the domain rules take. */
function toChecks(rows: Doc<'objectiveChecks'>[]): ObjectiveCheck[] {
	return rows.map((row) => ({
		objective: row.objective,
		rating: row.rating,
		answer: row.answer,
		confidence: row.confidence
	}));
}

/** The most rows any one list read returns. */
const LIST_MAX = 100;

/**
 * The conversation queue, newest activity first.
 *
 * Status is an equality on the index rather than a post-index filter, for the
 * reason `updates` learned the hard way: a filtered page can come back short of
 * `limit` while rows remain, and a short page is exactly how a reviewer
 * concludes an escalation queue is empty.
 */
export const listCheckins = query({
	args: {
		campaignId: v.optional(v.id('campaigns')),
		status: v.optional(
			v.union(
				v.literal('open'),
				v.literal('needs_review'),
				v.literal('escalated'),
				v.literal('drafted'),
				v.literal('closed')
			)
		),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'projects:read', args.campaignId ?? null);
		if (!orgId) return [];

		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 50), LIST_MAX));

		const rows = args.campaignId
			? args.status
				? await ctx.db
						.query('checkinConversations')
						.withIndex('by_campaignId_and_status', (q) =>
							q.eq('campaignId', args.campaignId!).eq('status', args.status!)
						)
						.order('desc')
						.take(limit)
				: await ctx.db
						.query('checkinConversations')
						.withIndex('by_campaignId_and_status', (q) => q.eq('campaignId', args.campaignId!))
						.order('desc')
						.take(limit)
			: args.status
				? await ctx.db
						.query('checkinConversations')
						.withIndex('by_orgId_and_status', (q) =>
							q.eq('orgId', orgId).eq('status', args.status!)
						)
						.order('desc')
						.take(limit)
				: await ctx.db
						.query('checkinConversations')
						.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
						.order('desc')
						.take(limit);

		return await Promise.all(
			rows.map(async (conversation) => {
				const project = await ctx.db.get('projects', conversation.projectId);
				return {
					...conversation,
					projectName: project?.name ?? null,
					projectNumber: project?.number ?? null
				};
			})
		);
	}
});

/**
 * One conversation, with everything behind it.
 *
 * The objective states are computed with the SAME domain functions the engine
 * uses — so the "still outstanding" a reviewer reads is the "still outstanding"
 * the machine acted on, rather than a second implementation that drifts.
 */
export const getCheckin = query({
	args: { conversationId: v.id('checkinConversations') },
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'projects:read');
		if (!orgId) return null;

		const conversation = await ctx.db.get('checkinConversations', args.conversationId);
		if (!conversation || conversation.orgId !== orgId) return null;
		// Re-gated with the row's own campaign, now that it is knowable.
		const scoped = await readableOrgId(ctx, 'projects:read', conversation.campaignId);
		if (!scoped) return null;

		const [messages, turns, checks, escalations] = await Promise.all([
			ctx.db
				.query('checkinMessages')
				.withIndex('by_conversationId_and_at', (q) => q.eq('conversationId', conversation._id))
				.take(LIST_MAX),
			ctx.db
				.query('conversationTurns')
				.withIndex('by_conversationId_and_turnNumber', (q) =>
					q.eq('conversationId', conversation._id)
				)
				.take(LIST_MAX),
			ctx.db
				.query('objectiveChecks')
				.withIndex('by_conversationId', (q) => q.eq('conversationId', conversation._id))
				.take(LIST_MAX),
			ctx.db
				.query('checkinEscalations')
				.withIndex('by_conversationId', (q) => q.eq('conversationId', conversation._id))
				.take(LIST_MAX)
		]);

		const project = await ctx.db.get('projects', conversation.projectId);

		return {
			conversation,
			project: project ? { name: project.name, number: project.number } : null,
			messages,
			turns,
			checks,
			escalations,
			// Serialized as an array of pairs rather than a Map: a Map is not a
			// Convex value, and a query that returns one fails at the boundary.
			objectiveStates: [...bestStates(conversation.objectives, toChecks(checks))].map(
				([objective, state]) => ({ objective, state })
			),
			nextDecision: decideNext({
				objectives: conversation.objectives,
				checks: toChecks(checks),
				turnsSpent: conversation.turnsSpent,
				escalated: conversation.status === 'escalated'
			})
		};
	}
});

/**
 * The escalation queue. Org-wide by default, because a family in danger is not
 * a per-campaign concern for whoever is on call.
 */
export const listEscalations = query({
	args: {
		status: v.optional(
			v.union(v.literal('open'), v.literal('acknowledged'), v.literal('resolved'))
		),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'projects:read');
		if (!orgId) return [];

		const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 50), LIST_MAX));
		const status = args.status ?? 'open';

		const rows = await ctx.db
			.query('checkinEscalations')
			.withIndex('by_orgId_and_status', (q) => q.eq('orgId', orgId).eq('status', status))
			.order('desc')
			.take(limit);

		// Re-checked per row rather than trusted from the org-wide gate above: a
		// team leader assigned to one campaign must not read another campaign's
		// disclosures out of a shared queue.
		const visible = [];
		for (const escalation of rows) {
			const scoped = await readableOrgId(ctx, 'projects:read', escalation.campaignId);
			if (!scoped) continue;
			const project = await ctx.db.get('projects', escalation.projectId);
			visible.push({
				...escalation,
				projectName: project?.name ?? null,
				projectNumber: project?.number ?? null
			});
		}
		return visible;
	}
});

/** The append-only prompt log, newest first. */
export const listPromptVersions = query({
	args: {},
	handler: async (ctx) => {
		const orgId = await readableOrgId(ctx, 'settings:manage');
		if (!orgId) return [];
		return await ctx.db
			.query('promptVersions')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.order('desc')
			.take(LIST_MAX);
	}
});

/**
 * Whether this deployment can run a check-in at all.
 *
 * Reports rather than throws, so an unconfigured deployment renders "not
 * connected" — the same shape the Stripe admin surface has.
 */
export const checkinSettings = query({
	args: {},
	handler: async (ctx) => {
		const orgId = await readableOrgId(ctx, 'projects:read');
		if (!orgId) return null;

		const prompts = await ctx.db
			.query('promptVersions')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.take(LIST_MAX);

		return {
			apiKeyConfigured: checkinsConfigured(),
			activeResponder: prompts.find((p) => p.role === 'responder' && p.isActive)?.version ?? null,
			activeDrafter: prompts.find((p) => p.role === 'drafter' && p.isActive)?.version ?? null,
			activeJudge: prompts.find((p) => p.role === 'judge' && p.isActive)?.version ?? null
		};
	}
});
