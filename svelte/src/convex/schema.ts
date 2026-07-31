import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// Convex has no unique constraints. Every "unique" noted below is enforced in
// the mutation layer via an index lookup before insert.

const campaigns = defineTable({
	orgId: v.string(),
	name: v.string(),
	slug: v.string(),
	status: v.union(v.literal('active'), v.literal('paused'), v.literal('archived')),

	// Display sequence prefix for project numbers, e.g. "P" -> P-031.
	numberPrefix: v.string(),
	// What this campaign calls its projects ("Family"/"Families").
	objectLabel: v.string(),
	objectLabelPlural: v.string(),
	// Frozen at creation so renaming the label never breaks public URLs.
	objectSlug: v.string(),

	theme: v.optional(v.string()),
	summary: v.optional(v.string()),
	story: v.optional(v.string()),
	coverImageUrl: v.optional(v.string()),
	iconUrl: v.optional(v.string()),
	promoVideoUrl: v.optional(v.string()),
	accent: v.optional(v.string()),

	membersEnabled: v.boolean(),
	budgetShape: v.union(v.literal('flat'), v.literal('template'), v.literal('none')),

	// Generalization of Jubilee's is_freed: the adjective, the past-tense verb
	// for stats, and how a project's goal gets marked met.
	goalLabel: v.string(),
	goalVerb: v.string(),
	goalTrigger: v.union(v.literal('manual'), v.literal('stage'), v.literal('task')),

	isPublished: v.boolean()
})
	// unique(orgId, slug)
	.index('by_orgId_and_slug', ['orgId', 'slug'])
	.index('by_orgId', ['orgId']);

// Small singleton per org: cross-campaign config + public-site chrome.
const orgSettings = defineTable({
	orgId: v.string(),
	campaignLabel: v.string(),
	campaignLabelPlural: v.string(),
	// Subdomain label, unique across orgs. Absent until claimed.
	slug: v.optional(v.string()),
	theme: v.optional(v.string()),
	publicName: v.optional(v.string()),
	publicTagline: v.optional(v.string())
})
	// unique(orgId), unique(slug)
	.index('by_orgId', ['orgId'])
	.index('by_slug', ['slug']);

// Stages are DATA, not an enum — admin-managed per campaign.
const pipelineStages = defineTable({
	orgId: v.string(),
	campaignId: v.id('campaigns'),
	key: v.string(),
	label: v.string(),
	order: v.number(),
	// 'terminal' = off-ramp (cancelled, freed by another org): excluded from
	// staleness checks and grouped as "Exited".
	kind: v.union(v.literal('funnel'), v.literal('terminal')),
	accent: v.optional(v.string()),
	// Where new projects start. Exactly one per campaign.
	isDefault: v.boolean(),
	// Triggers the fully-funded auto-task + public label. Exactly one per campaign.
	isFundedGate: v.boolean(),
	// Protected: relabel/recolor/reorder allowed, no delete, key immutable.
	isSystem: v.boolean()
})
	// unique(campaignId, key)
	.index('by_campaignId_and_key', ['campaignId', 'key'])
	.index('by_campaignId_and_order', ['campaignId', 'order']);

// Append-only. A new rate card is a new version; existing budgets keep the
// version they snapshotted.
const costTemplates = defineTable({
	orgId: v.string(),
	campaignId: v.id('campaigns'),
	version: v.string(),
	effectiveFrom: v.optional(v.string()),
	// { rent_cents, food_cents, school_cents, ... } — integer cents.
	lineItems: v.record(v.string(), v.number())
})
	// unique(campaignId, version)
	.index('by_campaignId_and_version', ['campaignId', 'version'])
	.index('by_campaignId', ['campaignId']);

// Append-only, same contract as costTemplates. Exactly one isActive per
// campaign, enforced in the mutation layer.
const taskTemplates = defineTable({
	orgId: v.string(),
	campaignId: v.id('campaigns'),
	version: v.string(),
	effectiveFrom: v.optional(v.string()),
	isActive: v.boolean(),
	// Bounded checklist (tens of items), so an inline array is safe here.
	// `impactTag` makes public impact stats data-driven rather than hardcoded.
	items: v.array(
		v.object({
			key: v.string(),
			label: v.string(),
			order: v.number(),
			impactTag: v.union(v.literal('business'), v.literal('school'), v.null())
		})
	)
})
	// unique(campaignId, version)
	.index('by_campaignId_and_version', ['campaignId', 'version'])
	.index('by_campaignId_and_isActive', ['campaignId', 'isActive']);

// Values for campaign-defined custom fields, keyed by field definition key.
// Mirrors the reference app's JSONB `attributes`; the field types it supports
// are text/longtext/number/money/date/select/boolean.
const attributeValue = v.union(v.string(), v.number(), v.boolean(), v.null());

// The sponsored case record. Called "projects" generically; a campaign renames
// it for display via objectLabel (Jubilee: "Family").
const projects = defineTable({
	orgId: v.string(),
	campaignId: v.id('campaigns'),
	// Display id, prefixed per campaign (e.g. P-031). Unique within an org.
	number: v.string(),
	name: v.string(),
	// A pipelineStages.key, not an enum — stages are admin-managed data.
	stage: v.string(),
	story: v.optional(v.string()),
	attributes: v.record(v.string(), attributeValue),
	note: v.optional(v.string()),
	managedMissionsLink: v.optional(v.string()),
	whatsappPhone: v.optional(v.string()),
	// INTERNAL ONLY (factory/site reference) — must never reach public queries.
	siteRef: v.optional(v.string()),
	photoUrl: v.optional(v.string()),
	// PUBLIC — the freedom video, intentionally exposed on the donor profile.
	videoUrl: v.optional(v.string()),
	// Public visibility, independent of pipeline stage.
	isPublished: v.boolean(),
	// Generalization of the reference app's is_freed: an independent admin flag,
	// decoupled from stage, and the single source of truth for goal-met counts.
	// The campaign supplies the wording via goalLabel/goalVerb.
	isGoalMet: v.boolean(),
	publishedAt: v.optional(v.number()),
	goalMetAt: v.optional(v.number())
})
	// unique(orgId, number)
	.index('by_orgId_and_number', ['orgId', 'number'])
	.index('by_campaignId', ['campaignId'])
	.index('by_campaignId_and_stage', ['campaignId', 'stage'])
	.index('by_campaignId_and_isPublished', ['campaignId', 'isPublished']);

// One per project. Snapshots a costTemplates version so later rate-card
// changes never retroactively alter an existing budget.
const budgets = defineTable({
	orgId: v.string(),
	projectId: v.id('projects'),
	templateVersion: v.string(),
	templateSnapshot: v.record(v.string(), v.number()),
	debtCents: v.number(),
	extras: v.array(v.object({ label: v.string(), amount_cents: v.number() })),
	// Stored, but always computed via the budgetTarget domain fn — never in UI.
	targetCents: v.number()
})
	// unique(projectId)
	.index('by_projectId', ['projectId'])
	.index('by_orgId', ['orgId']);

// Evidence attached to a project for a pipeline stage. Replaces the reference
// app's milestone checklist: stage itself expresses done-ness, documents carry
// the proof.
const documents = defineTable({
	orgId: v.string(),
	projectId: v.id('projects'),
	// The pipelineStages.key this document evidences.
	stage: v.string(),
	kind: v.union(
		v.literal('debt_evidence'),
		v.literal('receipt'),
		v.literal('legal_certificate'),
		v.literal('photo'),
		v.literal('agreement'),
		v.literal('other')
	),
	// Plain http(s) URL, or a Convex storage id resolved to a signed URL at
	// read time.
	url: v.optional(v.string()),
	storageId: v.optional(v.id('_storage')),
	notes: v.optional(v.string()),
	confirmedBy: v.optional(v.string()),
	// Receipt-grade metadata, all optional.
	company: v.optional(v.string()),
	amountCents: v.optional(v.number()),
	occurredOn: v.optional(v.string()),
	// A budget line-item key ('rent_cents'), 'debt', an extra's label, or unset.
	budgetItem: v.optional(v.string())
})
	.index('by_projectId', ['projectId'])
	.index('by_projectId_and_stage', ['projectId', 'stage'])
	.index('by_orgId', ['orgId']);

// The money ledger. Amounts are integer cents, always.
const transactions = defineTable({
	orgId: v.string(),
	type: v.union(v.literal('donation'), v.literal('transfer'), v.literal('expenditure')),
	amountCents: v.number(),
	occurredOn: v.optional(v.string()),
	method: v.optional(v.string()),
	reference: v.optional(v.string()),
	receiptUrl: v.optional(v.string()),
	// Donor attribution lands in Tier 2 with `contacts`; deliberately absent.
	note: v.optional(v.string())
})
	.index('by_orgId', ['orgId'])
	.index('by_orgId_and_type', ['orgId', 'type'])
	.index('by_orgId_and_occurredOn', ['orgId', 'occurredOn']);

// Attributes part of a transaction to a campaign, and optionally to one
// project. A project-less allocation is a campaign-level/overhead cost.
// Invariant: sum(allocations) <= transaction.amountCents.
const allocations = defineTable({
	orgId: v.string(),
	transactionId: v.id('transactions'),
	campaignId: v.id('campaigns'),
	// Cleared (not deleted) when a project is deleted, so ledger totals survive
	// and the allocation simply becomes campaign-level.
	projectId: v.optional(v.id('projects')),
	amountCents: v.number(),
	// A budget line-item key ('rent_cents'), 'debt', an extra's label, or unset.
	// Lives on the allocation, not the transaction, because one expenditure can
	// split across budget lines.
	budgetItem: v.optional(v.string())
})
	.index('by_transactionId', ['transactionId'])
	.index('by_transactionId_and_projectId', ['transactionId', 'projectId'])
	.index('by_projectId', ['projectId'])
	.index('by_campaignId', ['campaignId'])
	.index('by_orgId', ['orgId']);

export default defineSchema({
	campaigns,
	orgSettings,
	pipelineStages,
	costTemplates,
	taskTemplates,
	projects,
	budgets,
	documents,
	transactions,
	allocations
});
