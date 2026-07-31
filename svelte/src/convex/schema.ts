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

export default defineSchema({
	campaigns,
	orgSettings,
	pipelineStages,
	costTemplates,
	taskTemplates
});
