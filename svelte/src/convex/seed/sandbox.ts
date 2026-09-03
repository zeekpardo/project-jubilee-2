// ============================================================
// A sandbox for exercising the check-in engine
// ============================================================
// A campaign, three invented families, and the shipped prompts — enough to
// open a real check-in, answer it, watch the objectives move, trip the
// escalation scanner, and read the draft that comes out, without any of it
// touching a real family.
//
// NOT `seed/jubilee.ts`. That one loads real personal information about real
// people from a directory outside this repository, and it is emphatically not
// what you want to be typing invented WhatsApp replies into. Everything below
// is fabricated: the names are ordinary names from several places, the
// situations are the shapes the engine has to handle, and none of it came from
// anybody. PLAN-ai-checkin.md §2 — real family data never enters a fixture.
//
// Internal-only, driven from the CLI:
//
//   npx convex run seed/sandbox:seedSandbox '{}'
//   npx convex run seed/sandbox:wipeSandbox '{}'
//
// `orgId` is optional: with one organization on the deployment it is found,
// and with more than one the error says so and asks for it explicitly.
// ============================================================

import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { createCampaignModel } from '../model/campaigns';
import { createContactModel } from '../model/contacts';
import { createProjectModel } from '../model/projects';
import { deleteProjectCascade } from '../model/cascade';
import {
	activeWorkflowVersion,
	knownObjectiveKeys,
	deleteConversationCascade,
	familyChildFacts,
	recordInboundMessage,
	storedObjectives
} from '../model/checkins';
import { bestStates } from '../../lib/domain/checkin-objectives';
import {
	resolveObjectives,
	templateObjectives,
	DEFAULT_JUDGE_MODEL,
	SHIPPED_REPORT,
	type CheckinStep
} from '../../lib/domain/workflows';
import { DRAFTER_V1, JUDGE_V1, RESPONDER_V2 } from '../../lib/domain/checkin-prompts';

/** Everything this seed creates is tagged, so the wipe can find exactly it. */
const SANDBOX_MARKER = 'checkin-sandbox';
const SANDBOX_SLUG = 'checkin-sandbox';
const SANDBOX_CAMPAIGN_NAME = 'Check-in sandbox';

/**
 * The model the seeded prompt versions record themselves as written against.
 * Only metadata — the model actually called comes from `CHECKIN_RESPONDER_MODEL`
 * / `CHECKIN_JUDGE_MODEL` at request time.
 */
const SANDBOX_PROMPT_MODEL = 'claude-opus-5';
/** The judge runs a cheap tier, the same split production uses. */
const SANDBOX_JUDGE_MODEL = DEFAULT_JUDGE_MODEL;

/**
 * Three shapes, chosen because they are the three the objective rules branch
 * on and the three a first run should show you.
 *
 * Every person here is invented.
 */
const SANDBOX_FAMILIES: {
	name: string;
	story: string;
	adults: { firstName: string; lastName: string }[];
	children: { firstName: string; lastName: string; grade?: number }[];
}[] = [
	{
		// The full four objectives: work, school, children, wellbeing.
		name: 'Bekele',
		story: 'Invented family. Two adults, two children in school.',
		adults: [
			{ firstName: 'Amara', lastName: 'Bekele' },
			{ firstName: 'Tesfaye', lastName: 'Bekele' }
		],
		children: [
			{ firstName: 'Selam', lastName: 'Bekele', grade: 4 },
			{ firstName: 'Dawit', lastName: 'Bekele', grade: 1 }
		]
	},
	{
		// No children — `defaultObjectivesForFamily` drops both child objectives,
		// so a check-in here asks two questions rather than four. Worth opening
		// one of these second: it is the clearest demonstration that the objective
		// set is derived from the record rather than fixed.
		name: 'Nadeem',
		story: 'Invented family. Two adults, no children.',
		adults: [
			{ firstName: 'Farah', lastName: 'Nadeem' },
			{ firstName: 'Imran', lastName: 'Nadeem' }
		],
		children: []
	},
	{
		// One adult, one child. A conversation with a single parent reads
		// differently, and the responder should not address a household of two.
		name: 'Oduya',
		story: 'Invented family. One adult, one child in school.',
		adults: [{ firstName: 'Grace', lastName: 'Oduya' }],
		children: [{ firstName: 'Joy', lastName: 'Oduya', grade: 2 }]
	}
];

/** The organization to seed into, when the caller did not name one. */
async function resolveOrgId(ctx: MutationCtx, given: string | undefined): Promise<string> {
	if (given) return given;

	const settings = await ctx.db.query('orgSettings').take(5);
	const orgIds = [...new Set(settings.map((row) => row.orgId))];
	if (orgIds.length === 1) return orgIds[0];
	if (orgIds.length === 0) {
		throw new ConvexError(
			'No organization on this deployment yet. Sign in to the app once, then run this again.'
		);
	}
	throw new ConvexError(
		`This deployment has ${orgIds.length} organizations. Pass one: {"orgId":"${orgIds[0]}"}`
	);
}

/**
 * What the sandbox check-in asks.
 *
 * Its own set rather than `shippedWorkflowSteps()`, which stays as the thing a
 * NEW workflow is created with. The sandbox is where the engine is exercised,
 * so it carries the fuller conversation.
 *
 * EVERY `description` DESCRIBES AN ANSWER, NOT A QUESTION. It is the only text
 * the judge is given about an objective — no family profile, no history beyond
 * the recent turns — so "When were you rescued?" would tell it nothing about
 * when to mark the thing answered. The responder turns these into questions in
 * its own words; the judge grades against these.
 */
const SANDBOX_OBJECTIVES: CheckinStep[] = [
	{
		key: 'checkin',
		title: 'Life since the kiln',
		objectives: [
			{
				key: 'rescue_date',
				label: 'When they left',
				description:
					'When the family left the kiln. A satisfying answer gives a time — a month, a season, a year, or how long ago it was. An exact date is not needed and should not be pressed for.'
			},
			{
				key: 'wellbeing_now',
				label: 'How they are now',
				description:
					'How the family is doing at the moment: health, housing, money, spirits. A satisfying answer goes past a bare greeting and says something about how life is actually going.'
			},
			{
				key: 'since_rescue',
				label: 'What has happened since',
				description:
					'What has changed for the family since they left. A satisfying answer names at least one concrete thing that happened — a move, a job, a birth, a loss, a milestone — rather than a general "things are fine".'
			},
			{
				key: 'adapting',
				label: 'Adapting',
				description:
					'How the family has found adjusting to life outside the kiln. A satisfying answer says something about what has been hard or unfamiliar, or says plainly that it has been easier than they expected.'
			},
			{
				key: 'kids_update',
				label: 'Children',
				// The household rule, as data. A family with no children is not asked
				// after children who are not there.
				requires: ['hasChildren'],
				description:
					'How the children are doing — health, school, growth, anything the family wants to share about them. A satisfying answer says something specific about at least one child.'
			},
			{
				key: 'work_conditions',
				label: 'Work life',
				description:
					'What the work is like day to day: the hours, how they are treated, whether it is steady, whether they are paid when they should be. A satisfying answer describes the experience of the work, not only that work exists.'
			},
			{
				key: 'first_experience',
				label: 'Something new',
				description:
					'Something the family has done, seen or had for the first time since being freed. A satisfying answer names one specific thing. "Nothing yet" is a complete and acceptable answer — do not treat it as unanswered.'
			},
			{
				key: 'job_status',
				label: 'Work',
				description:
					'What work the adults in the family are doing now. A satisfying answer names the work, or says plainly that nobody is working yet.'
			}
		]
	}
];

/**
 * Create the sandbox. Idempotent by campaign slug — running it twice adds
 * nothing and returns what is already there, so it is safe to re-run when you
 * cannot remember whether you did.
 */
export const seedSandbox = internalMutation({
	args: { orgId: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const orgId = await resolveOrgId(ctx, args.orgId);

		// --- the org must exist as a settings row before a campaign hangs off it
		const settings = await ctx.db
			.query('orgSettings')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.first();
		if (!settings) {
			await ctx.db.insert('orgSettings', {
				orgId,
				campaignLabel: 'Campaign',
				campaignLabelPlural: 'Campaigns'
			});
		}

		// --- campaign ---------------------------------------------------------
		const existing = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId_and_slug', (q) => q.eq('orgId', orgId).eq('slug', SANDBOX_SLUG))
			.first();

		const campaignId: Id<'campaigns'> =
			existing?._id ??
			(await createCampaignModel(ctx, {
				orgId,
				name: SANDBOX_CAMPAIGN_NAME,
				slug: SANDBOX_SLUG,
				objectLabel: 'Family',
				objectLabelPlural: 'Families',
				goalLabel: 'Freed',
				goalVerb: 'freed',
				numberPrefix: 'SB',
				membersEnabled: true,
				budgetShape: 'none'
			}));

		// --- workflow ---------------------------------------------------------
		// One published workflow, so the sandbox can actually run. Seeded here
		// rather than left to the admin screen for the same reason the prompts
		// were: a first run should have everything it needs.
		//
		// Published immediately, unlike a real org where publishing is a separate
		// decision made after replaying conversations against the new wording. A
		// sandbox has nothing to protect and everything to gain from running the
		// newest thing this build ships.
		let workflowsAdded = 0;
		const existingWorkflow = await ctx.db
			.query('workflows')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
			.first();

		if (!existingWorkflow) {
			const workflowId = await ctx.db.insert('workflows', {
				orgId,
				campaignId: campaignId,
				name: 'Sandbox check-in',
				description: SANDBOX_MARKER,
				trigger: { kind: 'manual' as const },
				steps: SANDBOX_OBJECTIVES,
				report: {
					titleGuidance: SHIPPED_REPORT.titleGuidance,
					instructions: SHIPPED_REPORT.instructions,
					sections: SHIPPED_REPORT.sections
				},
				prompts: {
					responder: { content: RESPONDER_V2.content, model: SANDBOX_PROMPT_MODEL },
					judge: { content: JUDGE_V1.content, model: SANDBOX_JUDGE_MODEL },
					drafter: { content: DRAFTER_V1.content, model: SANDBOX_PROMPT_MODEL }
				},
				status: 'draft' as const
			});

			const versionId = await ctx.db.insert('workflowVersions', {
				orgId,
				workflowId,
				campaignId: campaignId,
				version: 1,
				publishedAt: Date.now(),
				publishedByUserId: SANDBOX_MARKER,
				name: 'Sandbox check-in',
				trigger: { kind: 'manual' as const },
				steps: SANDBOX_OBJECTIVES,
				report: {
					titleGuidance: SHIPPED_REPORT.titleGuidance,
					instructions: SHIPPED_REPORT.instructions,
					sections: SHIPPED_REPORT.sections
				},
				prompts: {
					responder: { content: RESPONDER_V2.content, model: SANDBOX_PROMPT_MODEL },
					judge: { content: JUDGE_V1.content, model: SANDBOX_JUDGE_MODEL },
					drafter: { content: DRAFTER_V1.content, model: SANDBOX_PROMPT_MODEL }
				}
			});

			await ctx.db.patch('workflows', workflowId, {
				status: 'published' as const,
				currentVersionId: versionId
			});
			workflowsAdded = 1;
		}

		// --- families ---------------------------------------------------------
		const created: { number: string; name: string }[] = [];

		for (const family of SANDBOX_FAMILIES) {
			const projectName = `The ${family.name} family`;
			const already = await ctx.db
				.query('projects')
				.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
				.take(100);
			if (already.some((project) => project.name === projectName)) continue;

			const projectId = await createProjectModel(ctx, {
				orgId,
				campaignId,
				name: projectName,
				story: family.story,
				isGoalMet: true,
				// Never published. A sandbox record must not be able to reach the
				// public site even by accident.
				isPublished: false
			});

			// Adults and children are walked separately rather than concatenated and
			// tested for membership: `child` and `grade` decide the objective set,
			// and inferring which list a person came from is exactly the kind of
			// cleverness that silently mislabels somebody.
			const people = [
				...family.adults.map((person) => ({ ...person, isChild: false, grade: undefined })),
				...family.children.map((person) => ({ ...person, isChild: true }))
			];

			for (const person of people) {
				const isChild = person.isChild;
				const contactId = await createContactModel(ctx, {
					orgId,
					firstName: person.firstName,
					lastName: person.lastName,
					child: isChild,
					grade: person.grade,
					// The marker the wipe keys off. `notes` rather than a column of its
					// own: this is dev scaffolding and does not deserve schema surface.
					notes: SANDBOX_MARKER,
					source: SANDBOX_MARKER
				});

				await ctx.db.insert('projectMembers', {
					orgId,
					projectId,
					contactId,
					role: isChild ? 'child' : 'parent',
					// `served`, not `team` — these are the family the campaign exists
					// for, and `buildFamilyProfile` skips the team side.
					side: 'served' as const,
					attributes: {}
				});
			}

			const project = await ctx.db.get('projects', projectId);
			if (project) created.push({ number: project.number, name: project.name });
		}

		return {
			orgId,
			campaignId,
			campaign: SANDBOX_CAMPAIGN_NAME,
			workflowsAdded,
			families: created
		};
	}
});

/**
 * Remove the sandbox and everything in it.
 *
 * Scoped to the sandbox campaign, so it cannot reach a real one: the records go
 * through `deleteProjectCascade`, which already knows to take their
 * conversations, transcripts, ratings and escalations with them.
 *
 * The seeded PROMPT VERSIONS are left alone. They are append-only by design and
 * a conversation elsewhere may name one; deleting them to tidy up a sandbox
 * would break the replay set the whole logging design exists to protect.
 */
export const wipeSandbox = internalMutation({
	args: { orgId: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const orgId = await resolveOrgId(ctx, args.orgId);

		const campaign = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId_and_slug', (q) => q.eq('orgId', orgId).eq('slug', SANDBOX_SLUG))
			.first();
		if (!campaign) return { removed: 0 };

		const projects = await ctx.db
			.query('projects')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.take(100);

		for (const project of projects) {
			await deleteProjectCascade(ctx, project._id);
		}

		// Conversations opened against a PERSON in this campaign rather than a
		// record are not reached by the loop above — same gap the campaign cascade
		// closes, and for the same reason.
		const conversations = await ctx.db
			.query('checkinConversations')
			.withIndex('by_campaignId_and_status', (q) => q.eq('campaignId', campaign._id))
			.take(100);
		for (const conversation of conversations) {
			await deleteConversationCascade(ctx, conversation._id);
		}

		// The workflow and its published versions. Not reached by anything above:
		// the campaign SURVIVES a wipe, so `deleteCampaignCascade` — which does
		// sweep these — never runs. Without this, a wipe followed by a reseed
		// silently keeps the old objective set, because seeding is idempotent on
		// "does a workflow already exist" and would find the stale one.
		const versions = await ctx.db
			.query('workflowVersions')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.take(100);
		for (const version of versions) {
			await ctx.db.delete('workflowVersions', version._id);
		}

		const sandboxWorkflows = await ctx.db
			.query('workflows')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.take(100);
		for (const workflow of sandboxWorkflows) {
			await ctx.db.delete('workflows', workflow._id);
		}

		return {
			removed: projects.length,
			workflowsRemoved: sandboxWorkflows.length,
			campaignId: campaign._id
		};
	}
});

// ============================================================
// Driving a conversation from the terminal
// ============================================================
// The app's own mutations gate on a signed-in staff member, which is right and
// also means a whole check-in cannot be exercised from a shell. These three do
// the same work with the capability check removed, so the engine can be run and
// read end to end without a browser.
//
// Internal-only, exactly like `seed:resetOrg` already in this repo: not
// reachable from a client, callable only with deploy credentials. They are
// scoped to the sandbox campaign and refuse anything outside it, so the missing
// capability check cannot be pointed at a real family.
//
//   npx convex run seed/sandbox:openSandboxCheckin '{"number":"SB-001"}'
//   npx convex run seed/sandbox:sandboxReply '{"conversationId":"...","text":"..."}'
//   npx convex run seed/sandbox:sandboxTranscript '{"conversationId":"..."}'
// ============================================================

/** Refuses any conversation or record outside the sandbox campaign. */
async function requireSandboxCampaign(
	ctx: MutationCtx | QueryCtx,
	campaignId: Id<'campaigns'>
): Promise<void> {
	const campaign = await ctx.db.get('campaigns', campaignId);
	if (!campaign || campaign.slug !== SANDBOX_SLUG) {
		throw new ConvexError('That is not the sandbox campaign. These helpers only work there.');
	}
}

/** Open a check-in with one sandbox family and write the first message. */
export const openSandboxCheckin = internalMutation({
	args: { number: v.optional(v.string()), orgId: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const orgId = await resolveOrgId(ctx, args.orgId);

		const campaign = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId_and_slug', (q) => q.eq('orgId', orgId).eq('slug', SANDBOX_SLUG))
			.first();
		if (!campaign) throw new ConvexError('Seed the sandbox first: seed/sandbox:seedSandbox');

		const projects = await ctx.db
			.query('projects')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
			.take(100);
		const project = args.number ? projects.find((row) => row.number === args.number) : projects[0];
		if (!project) throw new ConvexError(`No sandbox record ${args.number ?? '(first)'}`);

		const open = projects.length
			? await ctx.db
					.query('checkinConversations')
					.withIndex('by_projectId_and_status', (q) =>
						q.eq('projectId', project._id).eq('status', 'open')
					)
					.first()
			: null;
		if (open) return { conversationId: open._id, reused: true, record: project.number };

		// Resolved exactly the way production resolves it, rather than assembled
		// by hand. This site used to build its own objective set and name three
		// prompt versions with no template and no format, so the sandbox was
		// quietly exercising a configuration no real check-in could have.
		const version = await activeWorkflowVersion(ctx, campaign._id);
		if (!version) throw new ConvexError('Seed the sandbox before opening a check-in.');

		const authored = {
			version: String(version.version),
			name: version.name,
			steps: version.steps
		};
		const [facts, knownKeys] = await Promise.all([
			familyChildFacts(ctx, project),
			knownObjectiveKeys(ctx, {
				objectives: templateObjectives(authored),
				project,
				contactId: undefined
			})
		]);
		const resolved = resolveObjectives(authored, { knownKeys, facts });
		const now = Date.now();

		const conversationId = await ctx.db.insert('checkinConversations', {
			orgId,
			campaignId: campaign._id,
			projectId: project._id,
			kind: 'checkin' as const,
			status: 'open' as const,
			objectives: resolved,
			workflowVersionId: version._id,
			locale: 'en',
			turnsSpent: 0,
			openedAt: now
		});

		await ctx.scheduler.runAfter(0, internal.checkins.engine.advanceTurn, { conversationId });
		return {
			conversationId,
			reused: false,
			record: project.number,
			// The set actually frozen onto the row, re-read rather than recomputed:
			// this used to call the resolver a second time, which could report a
			// different set from the one the conversation was opened with.
			objectives: resolved.map((objective) => objective.key)
		};
	}
});

/** Record a reply from the family, exactly as `receiveMessage` would. */
export const sandboxReply = internalMutation({
	args: { conversationId: v.id('checkinConversations'), text: v.string() },
	handler: async (ctx, args) => {
		const conversation = await ctx.db.get('checkinConversations', args.conversationId);
		if (!conversation) throw new ConvexError('Conversation not found');
		await requireSandboxCampaign(ctx, conversation.campaignId);

		const text = args.text.trim();
		if (!text) throw new ConvexError('A reply needs text');

		// The SAME function the public mutation calls, so the scan-before-model
		// rule is exercised here rather than reimplemented around.
		return await recordInboundMessage(ctx, conversation, text, Date.now());
	}
});

/** Everything a terminal needs to see what the engine did. */
export const sandboxTranscript = internalQuery({
	args: { conversationId: v.id('checkinConversations') },
	handler: async (ctx, args) => {
		const conversation = await ctx.db.get('checkinConversations', args.conversationId);
		if (!conversation) return null;

		const [messages, turns, checks, escalations] = await Promise.all([
			ctx.db
				.query('checkinMessages')
				.withIndex('by_conversationId_and_at', (q) => q.eq('conversationId', conversation._id))
				.take(100),
			ctx.db
				.query('conversationTurns')
				.withIndex('by_conversationId_and_turnNumber', (q) =>
					q.eq('conversationId', conversation._id)
				)
				.take(100),
			ctx.db
				.query('objectiveChecks')
				.withIndex('by_conversationId', (q) => q.eq('conversationId', conversation._id))
				.take(100),
			ctx.db
				.query('checkinEscalations')
				.withIndex('by_conversationId', (q) => q.eq('conversationId', conversation._id))
				.take(20)
		]);

		return {
			status: conversation.status,
			reviewReason: conversation.reviewReason ?? null,
			turnsSpent: conversation.turnsSpent,
			hasDraft: Boolean(conversation.updateId),
			states: [...bestStates(storedObjectives(conversation), checks)].map(
				([objective, state]) => `${objective}: ${state}`
			),
			transcript: messages.map(
				(row) => `${row.direction === 'outbound' ? 'US ' : 'THEM'} | ${row.text}`
			),
			// Input and output are deliberately omitted — a terminal dump of every
			// full prompt is unreadable, and the app's Model calls tab is where they
			// belong. What is useful here is that a call happened and whether it worked.
			calls: turns.map(
				(row) =>
					`t${row.turnNumber} ${row.role} ${row.model} ${row.latencyMs}ms${row.error ? ` ERROR: ${row.error}` : ''}`
			),
			escalations: escalations.map((row) => `${row.category} (${row.status}) "${row.term}"`)
		};
	}
});
