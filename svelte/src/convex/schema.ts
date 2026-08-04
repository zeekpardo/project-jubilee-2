import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// Convex has no unique constraints. Every "unique" noted below is enforced in
// the mutation layer via an index lookup before insert.

// Values for campaign-defined custom fields, keyed by field definition key.
// Mirrors the reference app's JSONB `attributes`; the field types it supports
// are text/longtext/number/money/date/select/boolean.
const attributeValue = v.union(v.string(), v.number(), v.boolean(), v.null());

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
	// Uploaded cover/icon blobs, the storage-backed counterparts to the two
	// URLs above — same pairing as projects.photoStorageId. Only one of each
	// pair is ever set, so a pasted URL and an upload cannot both claim the
	// slot. These ids are the only handle to the blob, so deleting a campaign
	// must delete them first or the storage leaks.
	coverImageStorageId: v.optional(v.id('_storage')),
	iconStorageId: v.optional(v.id('_storage')),
	promoVideoUrl: v.optional(v.string()),
	accent: v.optional(v.string()),

	membersEnabled: v.boolean(),
	budgetShape: v.union(v.literal('flat'), v.literal('template'), v.literal('none')),

	// Generalization of Jubilee's is_freed: the adjective, the past-tense verb
	// for stats, and how a project's goal gets marked met.
	goalLabel: v.string(),
	goalVerb: v.string(),
	goalTrigger: v.union(v.literal('manual'), v.literal('stage'), v.literal('task')),

	isPublished: v.boolean(),
	// Custom field values, keyed by customFieldDefinitions.key.
	attributes: v.record(v.string(), attributeValue),

	// Which impact numbers this campaign publishes, in what order, under what
	// label, on which surface. Inline for the same reason taskTemplates.items
	// is: bounded (a handful of tiles) and always read together.
	//
	// UNSET means "fall back to the registry defaults", which is what lets this
	// ship without a migration — see defaultStatConfigs in
	// lib/domain/campaign-stats.ts. An EMPTY array is a different thing: a
	// deliberate "publish nothing".
	publicStats: v.optional(
		v.array(
			v.object({
				// Derived from the source (statConfigId), so the same number can
				// never appear twice under two ids.
				id: v.string(),
				// Override; unset = the source's own default wording.
				label: v.optional(v.string()),
				order: v.number(),
				showOnPublic: v.boolean(),
				showOnDashboard: v.boolean(),
				source: v.union(
					v.object({ kind: v.literal('builtin'), metric: v.string() }),
					v.object({
						kind: v.literal('field'),
						fieldKey: v.string(),
						aggregate: v.union(v.literal('sum'), v.literal('count'), v.literal('countWhere')),
						// countWhere only.
						matchValue: v.optional(v.string())
					}),
					v.object({ kind: v.literal('task'), impactTag: v.string() }),
					// Counts PEOPLE, not records: "children enrolled in school" is
					// a number one record can contribute several to. Three choices —
					// which records, which people on them, and whether the answer is
					// people or records-with-at-least-one.
					v.object({
						kind: v.literal('member'),
						among: v.union(
							v.object({ kind: v.literal('all') }),
							v.object({ kind: v.literal('goalMet') }),
							v.object({ kind: v.literal('task'), impactTag: v.string() })
						),
						// Unset counts everyone on the records, donors excluded.
						filter: v.optional(
							v.union(
								v.object({ dimension: v.literal('householdRole'), value: v.string() }),
								v.object({ dimension: v.literal('relationship'), value: v.string() }),
								v.object({
									dimension: v.literal('contactField'),
									fieldKey: v.string(),
									matchValue: v.optional(v.string())
								})
							)
						),
						count: v.union(v.literal('people'), v.literal('records'))
					})
				)
			})
		)
	)
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
	publicTagline: v.optional(v.string()),

	// The privacy dials this org owns. Both default to the shipped values —
	// see lib/domain/public-policy.ts for why they are per-org at all.
	// A public count below this is withheld; 0 disables suppression, which is
	// a real choice for an org whose records are not people.
	publicCountThreshold: v.optional(v.number()),
	// Keys this org protects ON TOP of the shared denylist, never instead of
	// it: the shared list protects the people this app serves, not the tenant.
	protectedFieldKeys: v.optional(v.array(v.string())),

	// The org page does NOT sum across campaigns: adding "families freed" to
	// "attendees reached" produces a number that means nothing. Instead the
	// admin picks which campaigns to surface, and each renders as its own
	// section reusing that campaign's own publicStats — so a stat cannot say
	// one thing on a campaign page and another here. Unset or empty means no
	// stats section at all.
	publicStatSections: v.optional(
		v.array(
			v.object({
				campaignId: v.id('campaigns'),
				// Unset = the campaign's own name.
				heading: v.optional(v.string()),
				order: v.number()
			})
		)
	),

	// Tax acknowledgment identity, for the receipts we send after an online
	// gift. Stripe's own receipt carries none of this and is not a substitute:
	// a US contemporaneous written acknowledgment needs the charity's legal
	// name and EIN, the amount, and a goods-and-services statement.
	//
	// Separate from `publicName` on purpose — an org fundraises as "Habitat
	// Tulsa" and acknowledges as "Habitat for Humanity of Tulsa County, Inc."
	legalName: v.optional(v.string()),
	ein: v.optional(v.string()),
	// Overrides the default "No goods or services were provided in exchange for
	// this contribution." Orgs whose gifts do carry a benefit must say so
	// themselves, in their own words.
	acknowledgmentText: v.optional(v.string())
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
	isSystem: v.boolean(),
	// Whether records sitting in this stage count toward impact stats.
	// A freed family and a record entered in error can BOTH sit in a terminal
	// stage, and only one of them is impact — `kind` alone cannot tell them
	// apart. Absent means true: a stage counts unless someone says otherwise,
	// so existing campaigns keep the numbers they had.
	countsTowardImpact: v.optional(v.boolean())
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
			// Free text, not a union: a campaign should be able to tag "Well
			// drilled" or "Bicycle given" without a schema change. Absent means
			// the item feeds no stat — it is purely an operational task.
			//
			// The tag IS the stat: several items can carry the same one, and the
			// count is over distinct records, so a family with two `business`
			// milestones counts once. Where that stat appears — public site,
			// dashboard, neither — lives on the campaign's matching
			// `publicStats` row, not here, because it is a property of the stat
			// rather than of any one checklist item.
			//
			// MIGRATION NOTE: this was `v.union(v.literal('business'),
			// v.literal('school'), v.null())`. Widening to an optional string is
			// backward-compatible for the strings, but a stored `null` is not a
			// string — normaliseTaskTemplateItems in migrations.ts drops it. A
			// sibling `isPublic` flag also lived here and was collapsed into the
			// stat's own showOnPublic — see dropChecklistIsPublic.
			impactTag: v.optional(v.string())
		})
	)
})
	// unique(campaignId, version)
	.index('by_campaignId_and_version', ['campaignId', 'version'])
	.index('by_campaignId_and_isActive', ['campaignId', 'isActive']);

// Who a task is on. Polymorphic because the same job can belong to a staff
// member or to a contact — and once contacts.authUserId is set the two are the
// same person, which is why "assigned to me" has to be resolved in one place
// rather than compared per call site. See lib/features/tasks.
const taskAssignee = v.union(
	v.object({ kind: v.literal('user'), userId: v.string() }),
	v.object({ kind: v.literal('contact'), contactId: v.id('contacts') })
);

// A unit of work. Two kinds live here, told apart by `source`:
//
//   'template' — a checklist item instantiated against one project. This is
//     what makes a task-sourced stat truthful: the number moves because work
//     got ticked off. Carries `templateVersion` and `key`.
//   'manual'   — anything someone typed. May or may not name a project; with
//     no `projectId` it is campaign-level work, which is the reason that
//     column is optional and the reason deleteCampaignCascade has to delete
//     tasks by campaignId (nothing else would reach a project-less one).
//
// One table rather than two because the list, the filters, the assignee and
// the due date are identical for both, and only three columns differ.
//
// label and impactTag are SNAPSHOTTED off the template item, for the same
// reason `budgets` snapshot a costTemplates version — rewording a checklist
// item must not silently rewrite what a completed task meant when it was
// ticked. It also means the stat query never joins back to the template.
//
// Whether the resulting count is PUBLISHED is deliberately not snapshotted.
// That is a present-tense decision about a number, made on the campaign's
// `publicStats` row, so turning a stat public includes ticks recorded before
// the switch was flipped — which is what an admin flipping it expects.
const tasks = defineTable({
	orgId: v.string(),
	// Optional: absent means campaign-level work that belongs to no record.
	// Impact stats count DISTINCT projectId, so a tagged task without one would
	// count zero forever — writes refuse `impactTag` when this is unset.
	projectId: v.optional(v.id('projects')),
	// Carried directly, never reached by traversal, so a stat query can never
	// pick up a task belonging to another campaign. Required for both sources:
	// every task belongs to exactly one campaign even when it names no project.
	campaignId: v.id('campaigns'),
	source: v.union(v.literal('template'), v.literal('manual')),
	// The taskTemplates version this was created against — templates are
	// append-only, so a task must remember whose wording it agreed to. Set iff
	// source is 'template'; a typed-in task agreed to nothing.
	templateVersion: v.optional(v.string()),
	// The template item's key, and the dedup key for instantiation. Manual
	// tasks have no natural key, so duplicates among them are allowed and are
	// the user's business.
	key: v.optional(v.string()),
	label: v.string(),
	// Free text. Replaces the old `note`, which said the same thing in a field
	// named for an afterthought — see backfillTaskDefaults in migrations.ts.
	description: v.optional(v.string()),
	order: v.number(),
	impactTag: v.optional(v.string()),
	// A pipelineStages.key, exactly like projects.stage: stages are
	// admin-managed data with immutable keys, so a rename cannot orphan this.
	// Label and filter only — it does not move the project's own stage.
	stageKey: v.optional(v.string()),
	// Cleared, not cascaded, when the person is deleted or leaves: the work
	// still happened. An id that no longer resolves renders "Unassigned".
	assignee: v.optional(taskAssignee),
	// ISO YYYY-MM-DD, like every other date here. A due date is a calendar day,
	// not an instant: epoch ms would make the same task overdue in Karachi and
	// not in Chicago.
	dueOn: v.optional(v.string()),
	priority: v.union(v.literal('low'), v.literal('normal'), v.literal('high'), v.literal('urgent')),
	status: v.union(v.literal('todo'), v.literal('done')),
	completedAt: v.optional(v.number()),
	// Better Auth user id.
	completedBy: v.optional(v.string())
})
	// unique(projectId, key) for template tasks only
	.index('by_projectId', ['projectId'])
	.index('by_projectId_and_key', ['projectId', 'key'])
	.index('by_campaignId_and_status', ['campaignId', 'status'])
	.index('by_campaignId_and_impactTag', ['campaignId', 'impactTag'])
	// The admin-wide list, and its campaign-scoped twin above. The orgId prefix
	// alone is also the only bounded way to reach tasks by assignee — that field
	// is optional and polymorphic, so it cannot carry a useful index of its own.
	.index('by_orgId_and_status', ['orgId', 'status'])
	// dueOn is the default sort on both pages, so the common case reads in index
	// order instead of sorting a page of rows in the handler.
	.index('by_campaignId_and_dueOn', ['campaignId', 'dueOn'])
	.index('by_orgId_and_dueOn', ['orgId', 'dueOn']);

// A saved filter set for the task lists.
const taskViews = defineTable({
	orgId: v.string(),
	// Better Auth user id. Views are personal unless deliberately published.
	ownerUserId: v.string(),
	name: v.string(),
	// Org-wide. Only settings:manage may set this true.
	isShared: v.boolean(),
	// The URL query string, stored VERBATIM. Filters already live in the URL, so
	// a saved view is literally "the URL I had" — no parallel filter schema to
	// keep in step, and a view is a shareable link. It may name a campaign the
	// viewer cannot access; applying it filters to what they may see, and never
	// widens access.
	query: v.string(),
	order: v.number()
})
	.index('by_orgId_and_ownerUserId', ['orgId', 'ownerUserId'])
	.index('by_orgId_and_isShared', ['orgId', 'isShared']);

// The sponsored case record. Called "projects" generically; a campaign renames
// it for display via objectLabel (Jubilee: "Family").
const projects = defineTable({
	orgId: v.string(),
	campaignId: v.id('campaigns'),
	// Display id, prefixed per campaign (e.g. P-031). Unique within an org.
	number: v.string(),
	name: v.string(),
	// What the public site may call this project. Admin-entered, never derived:
	// no rule can tell a given name from a surname across cultures, and this
	// app's users are endangered by their surname being published. Unset means
	// the public view shows no name at all.
	publicName: v.optional(v.string()),
	// A pipelineStages.key, not an enum — stages are admin-managed data.
	stage: v.string(),
	story: v.optional(v.string()),
	// Everything descriptive lives here rather than in fixed columns: what a
	// campaign needs to record differs per campaign, and a field marked not
	// public is withheld by the privacy wall automatically.
	attributes: v.record(v.string(), attributeValue),
	photoUrl: v.optional(v.string()),
	// An uploaded photo, as an alternative to a pasted photoUrl.
	photoStorageId: v.optional(v.id('_storage')),
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
	.index('by_campaignId_and_isPublished', ['campaignId', 'isPublished'])
	.index('by_campaignId_and_number', ['campaignId', 'number']);

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

// A post about what happened: what the money did, who was freed. Written by
// staff, read by donors. One table serves both parents, and exactly one of them
// is the subject: a campaign update is org-wide news, a project update is about
// one family.
//
// This is the first thing in this schema that stores FREE PROSE ABOUT A NAMED
// FAMILY, which is why publishing is its own decision rather than a property of
// the parent. `isProtectedFieldKey` can police custom fields because they have
// keys; a paragraph has none, so the control here is a capability
// (`content:publish`) held by fewer roles than the one that may write.
const updates = defineTable({
	orgId: v.string(),

	// Carried directly on BOTH kinds, never reached by traversal — the same
	// choice `tasks` makes and for the same reason: a project update needs its
	// campaign for the campaign feed and for capability gating, and a query that
	// had to traverse could pick up a row belonging to another campaign.
	// projectId absent means campaign-level.
	campaignId: v.id('campaigns'),
	projectId: v.optional(v.id('projects')),

	title: v.string(),
	// The public handle, so a post can be addressed as a blog page without an id
	// travelling — PLAN-updates.md §4c. Derived from the title by
	// lib/domain/update-slug.ts at FIRST publish and never recomputed: editing a
	// title afterwards must not retarget a link a supporter already shared.
	// Optional because a draft has no public address to be at yet; the wall
	// refuses to publish a row that reached `published` without one.
	slug: v.optional(v.string()),
	// Markdown, and the only representation. Raw HTML is never parsed, so
	// nothing typed here can become executable markup. Nothing is derived from
	// this string, so nothing can drift out of step with it — the reference
	// app's block-JSON-plus-derived-markdown pair could only be kept in step by
	// the one save path that wrote both.
	body: v.string(),

	// Every storage id the body references. Denormalized because a blob named
	// only from inside a string is unreachable by model/cascade.ts, which keys
	// off columns — these ids are the only handle for deletion, and deleting the
	// blob is the only way to revoke a storage URL that has already gone out.
	assetIds: v.array(v.id('_storage')),

	// The publish decision, independent of the parent's isPublished. A draft is
	// unreadable through the public query layer, not merely hidden by it.
	status: v.union(v.literal('draft'), v.literal('published')),
	// A real column, not _creationTime: the moment publishing happened, stamped
	// by the mutation from an argument. Presenting creation time as the publish
	// date is how the reference app made unpublishing and republishing invisible
	// to a reader.
	publishedAt: v.optional(v.number()),
	// Better Auth user id. "Posted by" is what makes an update feel written by a
	// person rather than emitted by a system.
	authorUserId: v.string()
})
	// Both feeds read status-first and newest-first; Convex appends
	// _creationTime as the final key, so a published feed needs no JS sort.
	.index('by_campaignId_and_status_and_publishedAt', ['campaignId', 'status', 'publishedAt'])
	.index('by_projectId_and_status_and_publishedAt', ['projectId', 'status', 'publishedAt'])
	// Addressing a post by its slug, and finding the siblings a new slug must not
	// collide with. `projectId` sits BETWEEN the campaign and the slug on purpose:
	// every row carries campaignId, including project ones, so a (campaignId,
	// slug) key would match across both levels and a campaign-level post would be
	// reachable at a record's URL. Here the level is part of the key — a
	// campaign-level lookup ranges over projectId `undefined` and cannot see a
	// record's posts, and a record's lookup pins its own id and cannot see the
	// campaign's.
	.index('by_campaignId_and_projectId_and_slug', ['campaignId', 'projectId', 'slug'])
	// The campaign-level feed, as an exact range rather than a filtered one.
	// Campaign-level means projectId ABSENT, which this expresses as an equality
	// against `undefined`; without it that condition is a post-index filter, and a
	// filtered page can come back short of `limit` while more rows remain, which
	// makes a short page useless as an end-of-feed signal for a paging blog index.
	.index('by_campaignId_and_projectId_and_status_and_publishedAt', [
		'campaignId',
		'projectId',
		'status',
		'publishedAt'
	])
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
	// An uploaded receipt blob, the storage-backed counterpart to receiptUrl —
	// mirrors how `projects` pairs photoStorageId with photoUrl. This id is the
	// only handle to the blob, so deleting the row must delete the blob first.
	receiptStorageId: v.optional(v.id('_storage')),
	// Donor attribution (donations). Cleared, not cascaded, if the contact is
	// deleted — the money still moved.
	contactId: v.optional(v.id('contacts')),
	note: v.optional(v.string()),

	// How much of this transaction its allocations account for, and whether
	// that covers the whole thing. Both are DERIVED — the allocations remain
	// the source of truth — and both are maintained by the trigger in
	// `functions.ts`, never by hand.
	//
	// They exist so the allocation inbox can be an indexed lookup instead of
	// reading every transaction and every allocation in the org to subtract
	// one from the other. Optional because rows written before the backfill
	// have neither; `allocatedCents ?? 0` is the safe read, and
	// `isFullyAllocated !== false` is deliberately NOT — an unmigrated row
	// must surface in the inbox rather than hide in it.
	allocatedCents: v.optional(v.number()),
	isFullyAllocated: v.optional(v.boolean())
})
	.index('by_orgId', ['orgId'])
	.index('by_orgId_and_type', ['orgId', 'type'])
	.index('by_orgId_and_occurredOn', ['orgId', 'occurredOn'])
	.index('by_contactId', ['contactId'])
	// The allocation inbox: "which of this org's money is not yet attributed".
	.index('by_orgId_and_isFullyAllocated', ['orgId', 'isFullyAllocated']);

// The ledger totals, kept per org so the budget page can render three numbers
// without reading three tables' worth of rows to add them up.
//
// A counter row rather than the `@convex-dev/aggregate` component, following
// the project guideline's own split: aggregate is for counts, ranks, offsets
// and arbitrary key ranges, while "a simple total" is what a denormalized
// counter document is for. This is six fixed sums per org.
//
// The tradeoff being accepted: every transaction write in an org contends on
// this one row, so a burst of simultaneous donations will produce OCC retries.
// That is fine at the scale a nonprofit's giving day produces, and if it ever
// stops being fine the upgrade is the aggregate component, whose tree
// structure exists precisely to spread that contention out.
//
// Never written by hand. The trigger in `functions.ts` owns it, which is what
// keeps it honest across the fourteen places that write a transaction.
const orgMoneyTotals = defineTable({
	orgId: v.string(),
	// Sums of `transactions.amountCents` by type.
	receivedCents: v.number(),
	sentCents: v.number(),
	spentCents: v.number(),
	// Sums of the UNALLOCATED remainder by type — what the inbox badges count.
	unallocatedDonationCents: v.number(),
	unallocatedTransferCents: v.number(),
	unallocatedExpenditureCents: v.number()
})
	// unique(orgId)
	.index('by_orgId', ['orgId']);

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

// ============================================================
// Online giving — Stripe Connect
// ============================================================
// Money still lands in `transactions` and `allocations`; nothing below
// duplicates the ledger. These tables hold the Stripe-shaped state around it:
// which account an org charges through, the lifecycle of a gift before it
// becomes a ledger row, and which webhook deliveries we have already seen.
//
// Direct charges, so the nonprofit is merchant of record. That is why every
// row here carries a `stripeAccountId` — the platform's own account never
// holds the money, and a webhook arrives knowing only the connected account
// it came from. See PLAN-stripe.md.

// The derived onboarding state, one step removed from Stripe's raw flags so
// the product surface never reads `details_submitted` and mistakes a finished
// form for a working account. `charges_only` is the one worth naming: KYC
// passed but the bank account did not, so gifts keep arriving into a balance
// the org cannot withdraw.
const stripeAccountStatus = v.union(
	v.literal('onboarding'),
	v.literal('pending_review'),
	v.literal('action_required'),
	v.literal('charges_only'),
	v.literal('active'),
	v.literal('restricted'),
	v.literal('rejected')
);

// One org's Connect account, one row per livemode — test and live `acct_` ids
// are different objects and must not overwrite each other.
//
// Deliberately NOT denormalized onto campaigns: whether a campaign can accept
// gifts is derived from this row's `status`, because Stripe owns that fact and
// a copy of it would drift the moment an account got restricted.
const stripeAccounts = defineTable({
	orgId: v.string(),
	stripeAccountId: v.string(),
	livemode: v.boolean(),

	// Mirrored from account.updated / accounts.retrieve. Never authoritative on
	// their own — `status` is what the app reads.
	chargesEnabled: v.boolean(),
	payoutsEnabled: v.boolean(),
	detailsSubmitted: v.boolean(),
	// active | pending | inactive | unrequested. Text rather than a union so a
	// new Stripe capability state does not fail a write.
	capabilityCardPayments: v.optional(v.string()),
	capabilityTransfers: v.optional(v.string()),
	// Bounded sets of Stripe requirement keys ('company.tax_id'), not unbounded
	// lists — they shrink to empty as onboarding completes.
	requirementsCurrentlyDue: v.array(v.string()),
	requirementsPastDue: v.array(v.string()),
	requirementsPendingVerification: v.array(v.string()),
	requirementsDisabledReason: v.optional(v.string()),
	requirementsCurrentDeadline: v.optional(v.number()),

	status: stripeAccountStatus,

	// Platform-owned config, not mirrored from Stripe.
	// The processing rate used to gross up a fee-covering gift. Per-org because
	// an org that wins Stripe's nonprofit discount pays ~2.2% while its
	// neighbour still pays 2.9%, and a constant here would silently overcharge
	// every donor of every discounted org.
	feeRate: v.number(),
	feeFixedCents: v.number(),
	// Our cut, in basis points. Zero today — the plumbing exists so switching it
	// on is a config change rather than a schema migration and a re-onboarding.
	platformFeeBps: v.number(),
	// Apple Pay / Google Pay / Link are invisible when unregistered: the Payment
	// Element simply omits the button. Registration is per connected account,
	// per domain, so what succeeded has to be recorded somewhere visible.
	walletDomainsRegistered: v.array(v.string()),

	// account.updated is chatty and arrives out of order. Guard applies against
	// this before overwriting mirrored state.
	lastEventCreatedAt: v.number(),
	lastSyncedAt: v.number()
})
	// unique(orgId, livemode), unique(stripeAccountId)
	.index('by_orgId', ['orgId'])
	.index('by_orgId_and_livemode', ['orgId', 'livemode'])
	// The webhook's only way home: an event knows its account, not our org.
	.index('by_stripeAccountId', ['stripeAccountId']);

// A gift from "donor pressed give" until it settles. The ledger never holds
// pending money — a `transactions` row is written only on success, and
// `transactionId` is the link back.
const donationIntents = defineTable({
	orgId: v.string(),
	campaignId: v.id('campaigns'),
	// Absent means a campaign-level gift, matching how allocations treat a
	// missing projectId.
	projectId: v.optional(v.id('projects')),

	status: v.union(
		v.literal('pending'),
		// ACH in flight. Emphatically not money yet, and never receipted.
		v.literal('processing'),
		v.literal('succeeded'),
		v.literal('failed'),
		v.literal('refunded'),
		v.literal('disputed')
	),

	// Three different numbers, all of which matter: what the donor meant to
	// give, what we actually charged once fee-cover was grossed up, and what
	// the org received after Stripe and we took ours.
	intendedCents: v.number(),
	chargedCents: v.number(),
	coverFees: v.boolean(),
	// Actuals, from the charge's balance_transaction. Optional because they
	// arrive after the intent succeeds, sometimes on a later charge.updated.
	stripeFeeCents: v.optional(v.number()),
	platformFeeCents: v.optional(v.number()),
	netCents: v.optional(v.number()),

	stripeAccountId: v.string(),
	stripePaymentIntentId: v.optional(v.string()),
	stripeChargeId: v.optional(v.string()),
	// Set when this gift is one installment of a recurring pledge, in which
	// case the invoice — not the payment intent — is the idempotency key.
	stripeInvoiceId: v.optional(v.string()),
	recurringGiftId: v.optional(v.id('recurringGifts')),

	contactId: v.optional(v.id('contacts')),
	donorName: v.optional(v.string()),
	donorEmail: v.optional(v.string()),
	// "Do not show my name publicly" — NOT "we do not know who this was".
	// The manual ledger models anonymity as a missing contactId and cannot tell
	// those apart; an online gift always knows the donor, because it has to
	// email them a receipt.
	anonymous: v.boolean(),
	designation: v.optional(v.string()),
	dedicationType: v.optional(v.union(v.literal('honor'), v.literal('memory'))),
	dedicationName: v.optional(v.string()),
	message: v.optional(v.string()),

	transactionId: v.optional(v.id('transactions')),
	failureMessage: v.optional(v.string()),

	// How much of this gift has been given back. Stripe fires `charge.refunded`
	// for PARTIAL refunds too, so a boolean here would quietly erase the
	// remaining nine tenths of a gift the donor only clawed back a tenth of.
	// Zero and absent both mean "nothing refunded".
	refundedCents: v.optional(v.number()),

	// Tax acknowledgment state. The number is immutable once assigned and
	// sequential per org per year ('2026-0007'), because a receipt series with
	// gaps or reuse is the first thing an auditor pulls on.
	receiptNumber: v.optional(v.string()),
	acknowledgedAt: v.optional(v.number()),
	// Set when a gift is refunded or disputed after we already told the donor
	// their contribution was deductible. The row is kept, not deleted — the
	// donor may have already filed on it.
	acknowledgmentVoidedAt: v.optional(v.number())
})
	.index('by_orgId', ['orgId'])
	.index('by_orgId_and_status', ['orgId', 'status'])
	.index('by_campaignId', ['campaignId'])
	// unique. The webhook resolves by this first; metadata is fallback only,
	// because an org admin can edit metadata in their own Stripe dashboard.
	.index('by_stripePaymentIntentId', ['stripePaymentIntentId'])
	.index('by_stripeInvoiceId', ['stripeInvoiceId'])
	.index('by_contactId', ['contactId']);

// A monthly (or annual) pledge: one Stripe Subscription living on the
// connected account, alongside its Customer. Each successful installment
// writes its own `donationIntents` row, so this table holds the standing
// arrangement and never the money.
const recurringGifts = defineTable({
	orgId: v.string(),
	campaignId: v.id('campaigns'),
	projectId: v.optional(v.id('projects')),
	contactId: v.optional(v.id('contacts')),

	status: v.union(
		v.literal('incomplete'),
		v.literal('active'),
		v.literal('past_due'),
		v.literal('paused'),
		v.literal('canceled')
	),
	amountCents: v.number(),
	interval: v.union(v.literal('month'), v.literal('year')),
	coverFees: v.boolean(),
	designation: v.optional(v.string()),
	anonymous: v.boolean(),

	stripeAccountId: v.string(),
	// Both live on the CONNECTED account, not ours — a consequence of direct
	// charges, and the reason a donor giving to four orgs has four customers.
	stripeCustomerId: v.string(),
	// Absent for the moment between this row being created and the
	// Subscription existing at Stripe. The row has to come first because its id
	// is the subscription's idempotency key, so this cannot be required.
	stripeSubscriptionId: v.optional(v.string()),
	currentPeriodEnd: v.optional(v.number()),
	cancelAtPeriodEnd: v.boolean(),

	donorEmail: v.optional(v.string()),
	donorName: v.optional(v.string())
})
	.index('by_orgId', ['orgId'])
	.index('by_orgId_and_status', ['orgId', 'status'])
	// unique
	.index('by_stripeSubscriptionId', ['stripeSubscriptionId'])
	.index('by_contactId', ['contactId']);

// One Stripe Product per campaign per connected account, because a
// subscription's inline `price_data` requires a Product id — it will not
// accept a bare name.
//
// A table rather than a column on `campaigns` for two reasons: the product
// lives on the CONNECTED account, so a test and a live account hold different
// ids for the same campaign, and `campaigns` should not grow a Stripe-shaped
// field for a feature most campaigns never turn on.
const stripeCampaignProducts = defineTable({
	orgId: v.string(),
	campaignId: v.id('campaigns'),
	stripeAccountId: v.string(),
	stripeProductId: v.string()
})
	// unique(campaignId, stripeAccountId)
	.index('by_campaignId_and_stripeAccountId', ['campaignId', 'stripeAccountId']);

// Money leaving an org's Stripe balance for their bank account.
//
// Mirrored from `payout.*` webhooks rather than fetched live, so the admin
// surface is one indexed read instead of a Stripe API call per page view — and
// so it still renders when Stripe is having a bad morning.
//
// `failed` is the row that earns this table its place. A failed payout means
// donations are piling up in a balance the org cannot reach, usually because a
// bank account was mistyped, and nothing else in the product would ever
// surface it.
const stripePayouts = defineTable({
	orgId: v.string(),
	stripeAccountId: v.string(),
	stripePayoutId: v.string(),

	amountCents: v.number(),
	currency: v.string(),
	status: v.union(
		v.literal('pending'),
		v.literal('in_transit'),
		v.literal('paid'),
		v.literal('canceled'),
		v.literal('failed')
	),
	// When Stripe expects it to land, in ms. Not when it was created.
	arrivalDate: v.optional(v.number()),
	failureCode: v.optional(v.string()),
	failureMessage: v.optional(v.string()),
	statementDescriptor: v.optional(v.string()),
	// `payout.created` time in ms, which is what the list is ordered by — the
	// row's own `_creationTime` is when the webhook reached us, which drifts.
	createdAt: v.number()
})
	// unique(stripePayoutId)
	.index('by_stripePayoutId', ['stripePayoutId'])
	.index('by_orgId', ['orgId'])
	.index('by_orgId_and_createdAt', ['orgId', 'createdAt']);

// A donor's bank taking money back, and the clock that comes with it.
//
// Under direct charges this debits the NONPROFIT's balance, not ours, which is
// exactly why it has to be visible in our admin: we are not the ones who will
// be told, and `evidenceDueBy` is a real deadline that passes silently.
const stripeDisputes = defineTable({
	orgId: v.string(),
	stripeAccountId: v.string(),
	stripeDisputeId: v.string(),

	stripeChargeId: v.string(),
	stripePaymentIntentId: v.optional(v.string()),
	// Absent when the disputed charge is not one we recorded — possible if an
	// org takes payments through the same Stripe account by other means.
	donationIntentId: v.optional(v.id('donationIntents')),

	amountCents: v.number(),
	currency: v.string(),
	// Stripe's own vocabulary ('fraudulent', 'product_not_received', …). Text
	// rather than a union so a new reason code cannot fail a write on a row we
	// need to record precisely when things are going wrong.
	reason: v.string(),
	status: v.string(),
	evidenceDueBy: v.optional(v.number()),
	createdAt: v.number()
})
	// unique(stripeDisputeId)
	.index('by_stripeDisputeId', ['stripeDisputeId'])
	.index('by_orgId', ['orgId'])
	.index('by_orgId_and_createdAt', ['orgId', 'createdAt'])
	.index('by_donationIntentId', ['donationIntentId']);

// The next receipt number to hand out, per org per calendar year.
//
// A counter row rather than counting the receipts already issued: Convex has
// no count operator, and `.collect().length` over a year of an active
// nonprofit's gifts is both slow and unbounded. Incrementing inside the same
// mutation that stamps the number is what makes the series gapless under
// concurrent donations.
const receiptCounters = defineTable({
	orgId: v.string(),
	// Calendar year the series belongs to. Receipts reset each January because
	// a donor's year-end statement covers one tax year.
	year: v.number(),
	nextNumber: v.number()
})
	// unique(orgId, year)
	.index('by_orgId_and_year', ['orgId', 'year']);

// Webhook delivery log, and the dedupe that makes handlers safe to re-run.
// Stripe guarantees at-least-once delivery and guarantees nothing about order,
// so both properties have to be handled here rather than assumed away:
// `stripeEventId` stops the redelivery, `createdAt` (event.created) is what an
// out-of-order guard compares against.
const stripeEvents = defineTable({
	stripeEventId: v.string(),
	type: v.string(),
	// Absent on platform events; present on everything arriving via Connect.
	stripeAccountId: v.optional(v.string()),
	livemode: v.boolean(),
	createdAt: v.number(),
	receivedAt: v.number(),
	// Unset until a handler finishes. A row with neither handledAt nor error is
	// in flight or was dropped, which is exactly what a reconciliation sweep
	// needs to find.
	handledAt: v.optional(v.number()),
	error: v.optional(v.string())
})
	// unique
	.index('by_stripeEventId', ['stripeEventId']);

// Where a piece of contact information reaches someone. Mirrors Planning
// Center's location on its Email/PhoneNumber/Address vertices.
const contactLocation = v.union(v.literal('home'), v.literal('work'), v.literal('other'));

// The unified person record: donors, project members, staff. Replaces the
// reference app's separate `sponsors` table. The scalar fields track Planning
// Center's Person attributes so an import can land without a translation
// layer; repeatable contact info lives in the child tables below.
const contacts = defineTable({
	orgId: v.string(),

	// --- Names -------------------------------------------------------------
	// firstName is the PREFERRED first name, matching Planning Center: the name
	// this person actually goes by. `givenName` holds the formal one when it
	// differs, so neither has to be reconstructed from the other.
	firstName: v.string(),
	// Optional: mononyms and organization contacts have no surname.
	lastName: v.optional(v.string()),
	givenName: v.optional(v.string()),
	middleName: v.optional(v.string()),
	// Administrative only — used for searching and confirming the right
	// profile, never for display.
	nickname: v.optional(v.string()),
	namePrefix: v.optional(v.string()),
	nameSuffix: v.optional(v.string()),
	// Admin-entered public first name, same reasoning as projects.publicName.
	// Deliberately separate from firstName so publishing a person's name stays
	// an explicit opt-in rather than a side effect of data entry.
	publicFirstName: v.optional(v.string()),

	// --- Primary contact info ----------------------------------------------
	// These are a PROJECTION of the isPrimary row in contactEmails /
	// contactPhones / contactAddresses, maintained by the model layer. They
	// exist because dedup, portal login, and every list view need one address
	// without a second query. Never patch them directly — go through the
	// child-table helpers so the projection cannot drift.
	email: v.optional(v.string()),
	// Lowercased `email`, kept alongside it so dedup can be a plain index
	// lookup. Postgres did this with a lower(email) expression index.
	emailLower: v.optional(v.string()),
	phone: v.optional(v.string()),
	addressLine1: v.optional(v.string()),
	addressLine2: v.optional(v.string()),
	city: v.optional(v.string()),
	state: v.optional(v.string()),
	postalCode: v.optional(v.string()),
	country: v.optional(v.string()),

	organization: v.optional(v.string()),
	notes: v.optional(v.string()),

	// --- Demographics ------------------------------------------------------
	// ISO YYYY-MM-DD, like every other date in this schema. Planning Center's
	// convention of a 1885 birth year meaning "year unknown" is a display
	// concern, not a storage one — it round-trips unchanged.
	birthdate: v.optional(v.string()),
	// Only meaningful alongside a married or widowed maritalStatus.
	anniversary: v.optional(v.string()),
	// Free text, not a union: this is self-described and orgs extend the list.
	gender: v.optional(v.string()),
	// Whether this person is a minor. Distinct from an age derived from
	// birthdate, which is often absent.
	child: v.optional(v.boolean()),
	// Planning Center's numeric grade scale: 12..1, 0 = Kindergarten,
	// -1 = Pre-K, -2/-3/-4 = Preschool 3s/2s/1s. Shifts by one when an org
	// enables Transitional Kindergarten, so the label is a localization
	// concern and only the number is stored.
	grade: v.optional(v.number()),
	graduationYear: v.optional(v.number()),
	schoolName: v.optional(v.string()),
	schoolType: v.optional(v.string()),
	// Sensitive: allergies, conditions, medications. Must never reach a public
	// query, the same way projects.siteRef must not.
	medicalNotes: v.optional(v.string()),

	// --- Membership and status ---------------------------------------------
	// Free text with org-defined values — Planning Center treats these as
	// case-sensitive custom lists, not enums.
	maritalStatus: v.optional(v.string()),
	membership: v.optional(v.string()),
	status: v.optional(v.union(v.literal('active'), v.literal('inactive'))),
	// Moved, New Church, Deceased, or org-defined. Only set when inactive.
	inactiveReason: v.optional(v.string()),
	inactivatedOn: v.optional(v.string()),
	// Campus name rather than an id: this app has no campus table, and the
	// importer matches on the name anyway.
	campus: v.optional(v.string()),
	avatarUrl: v.optional(v.string()),
	// Check-in barcodes. An array because Planning Center accumulates them —
	// an import adds one, it never overwrites the existing set.
	barcodes: v.optional(v.array(v.string())),
	// The id this person carries in the system they were imported from. Lets a
	// re-import match on identity instead of guessing from names.
	remoteId: v.optional(v.string()),
	// Denormalized from contactBackgroundChecks: true when, AS OF THE LAST
	// WRITE, some check was cleared and unexpired. Mirrors Planning Center's
	// Person attribute so a roster filter need not fan out over the child
	// table. Recomputed only when a check row changes, so a clearance that
	// lapses with no other edit leaves this reading true — anything that
	// gates access on screening must re-derive from contactBackgroundChecks
	// rather than trust this flag.
	passedBackgroundCheck: v.optional(v.boolean()),

	// Better Auth user id, set only for contacts who can sign in to the portal.
	authUserId: v.optional(v.string()),
	// Which path created this row: sponsor | project_member | subscriber |
	// manual | import.
	source: v.optional(v.string()),
	// Custom field values, keyed by customFieldDefinitions.key.
	customFields: v.record(v.string(), attributeValue),

	// --- Portal access ------------------------------------------------------
	// Where this person is in the invitation lifecycle. Absent means nobody has
	// ever offered them a login, which is not the same as having taken it away:
	// `revoked` is a STATE and not a deletion, because withdrawing access must
	// not erase the person or their giving. Checked on every portal read rather
	// than at sign-in, so a revocation takes effect at once.
	portalAccess: v.optional(
		v.union(v.literal('invited'), v.literal('active'), v.literal('revoked'))
	),
	// When the invitation was sent. Stamped by the shared invite helper, never
	// by a route — the reference app stamped it on one of its two invite paths
	// and not the other, so a contact invited by the second showed no badge.
	invitedAt: v.optional(v.number()),

	// --- Donor preferences --------------------------------------------------
	// How much detail this person wants in what we SEND them: "just outcomes"
	// or "every detail". Carried over from the retired sponsors table, where it
	// was called `transparency` — a name that reads like a permission and is
	// not one. Nothing about what a portal shows branches on it, and nothing
	// should; it is a mailing preference.
	updateDetail: v.optional(v.union(v.literal('summary'), v.literal('full'))),
	preferredContact: v.optional(v.union(v.literal('email'), v.literal('mail'), v.literal('phone')))
})
	// unique(orgId, emailLower) when email present; unique(orgId, authUserId);
	// unique(orgId, remoteId) when remoteId present
	.index('by_orgId', ['orgId'])
	.index('by_orgId_and_emailLower', ['orgId', 'emailLower'])
	.index('by_orgId_and_authUserId', ['orgId', 'authUserId'])
	.index('by_orgId_and_remoteId', ['orgId', 'remoteId'])
	.index('by_orgId_and_status', ['orgId', 'status']);

// Every address a contact has, including the primary one. Exactly one row per
// contact carries isPrimary, and the model layer projects it onto
// contacts.email/emailLower. Kept separate from the projection so a person can
// hold a work and a home address without either being lost.
const contactEmails = defineTable({
	orgId: v.string(),
	contactId: v.id('contacts'),
	address: v.string(),
	// Same pairing rule as contacts.emailLower: written only alongside
	// `address`, so the dedup key can never drift from the display value.
	addressLower: v.string(),
	location: contactLocation,
	isPrimary: v.boolean(),
	// Bounced or unsubscribed — excluded from sends, kept for the record.
	blocked: v.optional(v.boolean())
})
	// unique(contactId, addressLower); exactly one isPrimary per contact
	.index('by_contactId', ['contactId'])
	.index('by_contactId_and_addressLower', ['contactId', 'addressLower'])
	.index('by_orgId_and_addressLower', ['orgId', 'addressLower']);

const contactPhones = defineTable({
	orgId: v.string(),
	contactId: v.id('contacts'),
	number: v.string(),
	// 'mobile' is its own location rather than a flag on 'home': it is what
	// decides whether a number can be texted.
	location: v.union(contactLocation, v.literal('mobile')),
	isPrimary: v.boolean(),
	carrier: v.optional(v.string())
})
	// exactly one isPrimary per contact
	.index('by_contactId', ['contactId'])
	.index('by_orgId', ['orgId']);

const contactAddresses = defineTable({
	orgId: v.string(),
	contactId: v.id('contacts'),
	line1: v.optional(v.string()),
	line2: v.optional(v.string()),
	city: v.optional(v.string()),
	// Abbreviation or full name, stored as entered.
	state: v.optional(v.string()),
	postalCode: v.optional(v.string()),
	// Two-letter ISO code.
	countryCode: v.optional(v.string()),
	location: contactLocation,
	isPrimary: v.boolean()
})
	// exactly one isPrimary per contact
	.index('by_contactId', ['contactId'])
	.index('by_orgId', ['orgId']);

// Volunteer screening history. A child table because checks accumulate: a
// renewal is a new row, and the expired one stays as the record of when
// clearance lapsed.
const contactBackgroundChecks = defineTable({
	orgId: v.string(),
	contactId: v.id('contacts'),
	cleared: v.boolean(),
	completedOn: v.optional(v.string()),
	expiresOn: v.optional(v.string()),
	note: v.optional(v.string())
})
	.index('by_contactId', ['contactId'])
	.index('by_orgId', ['orgId']);

// A person-grouping entity in its own right, distinct from `projects` (which
// carry a budget and a pipeline). Many-to-many with contacts.
const households = defineTable({
	orgId: v.string(),
	name: v.string(),
	avatarUrl: v.optional(v.string()),
	// Cleared, not cascaded, if that contact is deleted: the household survives
	// because other members may remain.
	primaryContactId: v.optional(v.id('contacts'))
}).index('by_orgId', ['orgId']);

const householdMembers = defineTable({
	orgId: v.string(),
	householdId: v.id('households'),
	contactId: v.id('contacts'),
	role: v.union(
		v.literal('parent_guardian'),
		v.literal('adult'),
		v.literal('other_adult'),
		v.literal('child')
	),
	pending: v.boolean()
})
	// unique(householdId, contactId)
	.index('by_householdId_and_contactId', ['householdId', 'contactId'])
	.index('by_householdId', ['householdId'])
	.index('by_contactId', ['contactId']);

// Project <-> contact. A contact's identity is campaign-agnostic, so anything
// project-specific (age at intake, relationship) lives on the link, not the
// person.
const projectMembers = defineTable({
	orgId: v.string(),
	projectId: v.id('projects'),
	contactId: v.id('contacts'),
	// team_lead | leader | attendee | member | volunteer. Text rather than a
	// union so a campaign can use a word that fits its own work.
	role: v.string(),
	attributes: v.record(v.string(), attributeValue)
})
	// unique(projectId, contactId)
	.index('by_projectId_and_contactId', ['projectId', 'contactId'])
	.index('by_projectId', ['projectId'])
	.index('by_contactId', ['contactId']);

// Custom fields engine. One pair of tables powers custom fields for every
// entity and both scopes. A record's applicable fields are all org-scope fields
// for its entity, plus its campaign's own — see resolveFieldDefinitions in
// lib/domain/field-definitions.ts. Values live in the record's own bag keyed by
// `key`: contacts.customFields, projects.attributes, campaigns.attributes.
const fieldEntity = v.union(v.literal('contact'), v.literal('project'), v.literal('campaign'));
const fieldScope = v.union(v.literal('org'), v.literal('campaign'));

const customFieldCategories = defineTable({
	orgId: v.string(),
	entity: fieldEntity,
	scope: fieldScope,
	// Absent for org-scope categories; the owning campaign for campaign-scope.
	campaignId: v.optional(v.id('campaigns')),
	name: v.string(),
	order: v.number()
})
	.index('by_orgId_and_entity', ['orgId', 'entity'])
	.index('by_campaignId', ['campaignId']);

const customFieldDefinitions = defineTable({
	orgId: v.string(),
	entity: fieldEntity,
	scope: fieldScope,
	campaignId: v.optional(v.id('campaigns')),
	// Cleared, not cascaded, when a category is deleted: the field survives
	// as uncategorized.
	categoryId: v.optional(v.id('customFieldCategories')),
	key: v.string(),
	label: v.string(),
	type: v.union(
		v.literal('text'),
		v.literal('longtext'),
		v.literal('number'),
		v.literal('money'),
		v.literal('date'),
		v.literal('select'),
		v.literal('boolean')
	),
	// Choice list for type 'select'.
	options: v.optional(v.array(v.string())),
	order: v.number(),
	isRequired: v.boolean(),
	// Gates exposure through the public wall. Defaults to false everywhere:
	// a field is private until someone deliberately publishes it.
	isPublic: v.boolean()
})
	// unique(orgId, entity, key) at org scope;
	// unique(orgId, entity, campaignId, key) at campaign scope
	.index('by_orgId_and_entity', ['orgId', 'entity'])
	.index('by_orgId_and_entity_and_key', ['orgId', 'entity', 'key'])
	.index('by_campaignId_and_entity_and_key', ['campaignId', 'entity', 'key'])
	.index('by_categoryId', ['categoryId']);

// Which campaigns a team leader may work in. Carries orgId directly rather
// than being reached by traversal, so a lookup can never return an assignment
// belonging to a different organization.
const campaignAssignments = defineTable({
	orgId: v.string(),
	// Better Auth user id.
	userId: v.string(),
	campaignId: v.id('campaigns')
})
	// unique(orgId, userId, campaignId)
	.index('by_orgId_and_userId', ['orgId', 'userId'])
	.index('by_orgId_and_userId_and_campaignId', ['orgId', 'userId', 'campaignId'])
	.index('by_campaignId', ['campaignId']);

// A contact's place in a campaign. Someone can be a sponsor of one campaign
// and an attendee of another, so the role lives on the link rather than on the
// person. Deliberately separate from projectMembers: being part of a campaign
// does not require being attached to one of its projects.
const campaignMemberships = defineTable({
	orgId: v.string(),
	campaignId: v.id('campaigns'),
	contactId: v.id('contacts'),
	// sponsor | attendee | lead | staff. Text rather than a union so a new role
	// is additive.
	role: v.string()
})
	// unique(campaignId, contactId, role)
	.index('by_campaignId_and_contactId', ['campaignId', 'contactId'])
	.index('by_campaignId', ['campaignId'])
	.index('by_contactId', ['contactId']);

export default defineSchema({
	campaigns,
	orgSettings,
	pipelineStages,
	costTemplates,
	taskTemplates,
	tasks,
	taskViews,
	projects,
	budgets,
	documents,
	updates,
	transactions,
	allocations,
	orgMoneyTotals,
	stripeAccounts,
	donationIntents,
	recurringGifts,
	stripeCampaignProducts,
	stripePayouts,
	stripeDisputes,
	receiptCounters,
	stripeEvents,
	contacts,
	contactEmails,
	contactPhones,
	contactAddresses,
	contactBackgroundChecks,
	households,
	householdMembers,
	projectMembers,
	customFieldCategories,
	customFieldDefinitions,
	campaignAssignments,
	campaignMemberships
});
