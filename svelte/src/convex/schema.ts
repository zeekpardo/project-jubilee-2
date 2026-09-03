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

	// Most campaigns never run a trip, and a Trips tab on every campaign is a tab
	// that is empty forever. Optional rather than required so this ships without a
	// backfill — same pattern as pipelineStages.countsTowardImpact. Absent = false,
	// which is the opposite default to that one because the safe answer differs:
	// there, a stage counts unless someone says otherwise; here, a campaign does
	// not grow a feature unless someone asks for it.
	tripsEnabled: v.optional(v.boolean()),

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
	// Which kind of checklist this version is. Absent = 'project', so every
	// existing row keeps its meaning and this ships without a backfill. The
	// exactly-one-active invariant widens from (campaignId) to (campaignId,
	// scope): a campaign has one active record checklist AND one active trip
	// checklist, and they are different lists of different work.
	//
	// Reading the project-scope template ranges over `scope: undefined` — the
	// same explicit-undefined-in-an-index pattern `updates` uses for its
	// campaign-level feed, and for the same reason: a post-index filter can
	// return a short page while rows remain.
	scope: v.optional(v.union(v.literal('project'), v.literal('trip'))),
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
			impactTag: v.optional(v.string()),
			// True when this item is answered once PER PERSON rather than once per
			// trip. "Book group lodging" is a trip item; "passport valid 6 months
			// past return" is twelve items, one per traveller, and a single shared
			// tick would hide the one person who cannot board.
			perAttendee: v.optional(v.boolean())
		})
	)
})
	// unique(campaignId, version)
	.index('by_campaignId_and_version', ['campaignId', 'version'])
	.index('by_campaignId_and_isActive', ['campaignId', 'isActive'])
	// The scope-aware twin of the index above, and the one every read and the
	// single deactivateOthers enforcement point move to: scope-blind, activating
	// a trip checklist silently deactivates the campaign's record checklist.
	// Unstaged deliberately — this table holds a handful of rows per campaign,
	// so the backfill is nothing.
	.index('by_campaignId_and_scope_and_isActive', ['campaignId', 'scope', 'isActive']);

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
	// Trip work. NOT mutually exclusive with projectId: "visit the Rahman family"
	// is a checklist item on a trip AND about a record, and a task carrying both
	// is the one place a trip legitimately feeds an impact tag. The existing rule
	// is unchanged and still does the work — writes refuse `impactTag` when
	// projectId is unset, because impact stats count DISTINCT projectId.
	tripId: v.optional(v.id('trips')),
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
	// The trip twins of the two above, and the bounded read that instantiation
	// dedupes against.
	//
	// NOT unique(tripId, key), unlike the project pair above. A `perAttendee`
	// checklist item deliberately fans out to one row per traveller, all sharing
	// that pair and told apart by `assignee.contactId` — so instantiation dedupes
	// on (tripId, key) for a trip-wide item and (tripId, key, contactId) for a
	// per-attendee one. Reading this index as a uniqueness guarantee would make
	// `.unique()` throw the moment a trip has two travellers.
	//
	// ROLLOUT, not a property of these lines: this is the largest table in the
	// schema — one row per checklist item per record per campaign — and adding an
	// index to a large table blocks the deploy until its backfill finishes. So the
	// FIRST production deploy of this schema declares both as
	// `{ fields: [...], staged: true }` and a SECOND deploy restores the form
	// below. They are committed unstaged because a staged index cannot be queried,
	// and everything downstream of here — instantiation, the cascade, the trip
	// page — reads them. See PLAN-trips.md §13.
	.index('by_tripId', ['tripId'])
	.index('by_tripId_and_key', ['tripId', 'key'])
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
	//
	// A machine-drafted post carries the sentinel `AI_AUTHOR_USER_ID` from
	// model/checkins.ts rather than a real id — it resolves to nobody on
	// purpose, because attributing an AI draft to whoever happened to trigger it
	// would put a staff member's name on prose they have not read yet.
	authorUserId: v.string(),

	// The check-in this was drafted from, when a check-in drafted it. Absent on
	// everything a person wrote.
	//
	// Two jobs in one column: it MARKS the post as machine-written, so a reviewer
	// is never guessing, and it is the link back to the transcript and the
	// decision trace that produced it. An AI draft with no path back to its
	// evidence is not reviewable, it is just text.
	//
	// Cleared, not cascaded, if the conversation is deleted — the draft is still
	// a draft somebody may want to publish.
	checkinConversationId: v.optional(v.id('checkinConversations'))
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

	// Which payout this gift was settled in, stamped by `reconcilePayout` once
	// the money actually reaches the org's bank. Absent means the gift has not
	// been paid out yet — which is a real and common state, not a gap.
	stripePayoutId: v.optional(v.string()),

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
	.index('by_stripePayoutId', ['stripePayoutId'])
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
	createdAt: v.number(),

	// The breakdown behind `amountCents`, which Stripe does not send.
	//
	// A payout event carries only the net figure that reaches the bank. What it
	// was made of — which gifts, and what Stripe took — lives in the balance
	// transactions the payout settled, and has to be fetched and summed. That
	// is what `reconcilePayout` does, and why these are optional: a payout is
	// recorded the moment it is announced and enriched a moment later.
	//
	// `grossCents` and `feeCents` cover the DONATIONS in the payout only.
	// A payout also settles refunds, disputes and adjustments, so
	// `grossCents - feeCents` deliberately does NOT have to equal
	// `amountCents` — `otherCents` carries the difference rather than letting
	// the three columns silently fail to add up.
	grossCents: v.optional(v.number()),
	feeCents: v.optional(v.number()),
	otherCents: v.optional(v.number()),
	donationCount: v.optional(v.number()),
	reconciledAt: v.optional(v.number())
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
	preferredContact: v.optional(v.union(v.literal('email'), v.literal('mail'), v.literal('phone'))),

	// Everything a person might be searched by, lowercased into one string.
	//
	// Convex full-text search indexes exactly ONE field, and a contact is
	// findable by half a dozen — name, nickname, email, organization. So the
	// haystack is assembled here rather than searched across columns.
	//
	// Derived, and maintained by the trigger in `functions.ts` alongside the
	// org's contact count. Never written by hand: a stale haystack means a
	// person who cannot be found by the name they were just renamed to.
	searchText: v.optional(v.string())
})
	// unique(orgId, emailLower) when email present; unique(orgId, authUserId);
	// unique(orgId, remoteId) when remoteId present
	.index('by_orgId', ['orgId'])
	.index('by_orgId_and_emailLower', ['orgId', 'emailLower'])
	.index('by_orgId_and_authUserId', ['orgId', 'authUserId'])
	.index('by_orgId_and_remoteId', ['orgId', 'remoteId'])
	.index('by_orgId_and_status', ['orgId', 'status'])
	// `filterFields: ['orgId']` is load-bearing, not an optimization. A search
	// index without it would happily match contacts across every organization
	// on the platform — the tenant isolation that `withIndex(q.eq('orgId'))`
	// gives the other queries for free has to be asked for explicitly here.
	.searchIndex('search_contacts', {
		searchField: 'searchText',
		filterFields: ['orgId']
	});

// How many contacts an org has, so the dashboard's People tile can show a
// number without loading every person to count them.
//
// Convex has no count operator, and `.collect().length` over a growing table
// is the exact pattern the guidelines forbid — it reads every row to produce
// one integer. Maintained by the same trigger that maintains `searchText`.
const orgContactTotals = defineTable({
	orgId: v.string(),
	contactCount: v.number()
})
	// unique(orgId)
	.index('by_orgId', ['orgId']);

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
	// Which side of the work this person is on. `served` is the family the
	// campaign exists for; `team` is the organization's own people — the staffer,
	// the volunteer, the trip goer standing in the photograph. `role` cannot
	// answer this: it is free text so a campaign can use its own vocabulary,
	// which is exactly why no code should have to recognize "Team Lead",
	// "team_lead", and "Site Coordinator" as the same side of the work.
	//
	// On the LINK and not on the contact, because a contact's identity is
	// campaign-agnostic: the same person is a beneficiary of one campaign and a
	// volunteer on another campaign's trip.
	//
	// Absent means `served`, deliberately: every row written before this column
	// existed was entered as a person on a record, and reading those as `team`
	// would silently drop them out of an already-published impact number. New
	// rows are written explicitly, so the ambiguity has a shrinking lifetime.
	//
	// `campaignMemberships` deliberately does NOT get this column — nothing
	// counts it toward a published stat, so there the same ambiguity is a display
	// label rather than a wrong figure. If anything ever does count it, it
	// inherits this exact bug and the fix is this same column on that table.
	side: v.optional(v.union(v.literal('served'), v.literal('team'))),
	attributes: v.record(v.string(), attributeValue)
})
	// unique(projectId, contactId)
	.index('by_projectId_and_contactId', ['projectId', 'contactId'])
	.index('by_projectId', ['projectId'])
	.index('by_contactId', ['contactId']);

// ============================================================
// Trips
// ============================================================
// A campaign run as a missions trip: a group of the organization's own people
// travels somewhere, on dates, with flights, to do the campaign's work — and
// while they are there they visit some of the campaign's records.
//
// Internal-only, deliberately: no isPublished, no public query, no site route.
// A published trip page is a CORRELATION of exactly the facts the rest of this
// schema spends its privacy budget keeping apart — a country, a two-week
// window, the names of the people going, and the records they will visit. Each
// is individually mild; together they say who was visited, where, and when. A
// public "our team went to Pakistan in December" story belongs in `updates`,
// which has the second-pair-of-eyes publish gate and lets prose say what
// happened without publishing a roster and a visit schedule.
//
// The travellers are the `team` side of projectMembers.side above, which is why
// they live here rather than becoming more projectMembers rows. See
// PLAN-trips.md.

// A trip: people from the organization travelling somewhere, on dates, to do a
// campaign's work.
const trips = defineTable({
	orgId: v.string(),
	campaignId: v.id('campaigns'),

	// A trip needs a handle that survives the destination being renamed and two
	// trips going to the same country. Prefilled `{Campaign} — {Project} —
	// {startOn}` by the create dialog; the value is the user's from then on, the
	// same contract updates.slug has and for the same reason — a handle that
	// silently rewrites itself is not a handle.
	name: v.string(),

	// ISO YYYY-MM-DD, for the same reason tasks.dueOn is: a trip that runs
	// Dec 1–14 runs those days for everyone reading the page. Epoch ms would
	// start it on Nov 30 for half of them.
	startOn: v.string(),
	endOn: v.string(),

	// Freeform — "Pakistan", "Lahore, Pakistan", "Northern Thailand". A heading,
	// not a geocode: no place table survives the first trip to somewhere it does
	// not list, and this app's destinations are exactly the places a gazetteer
	// is thin on.
	destination: v.string(),
	// Two-letter ISO, optional, for grouping and flags only. Never required —
	// a trip can be domestic, or to a place whose code is politically contested.
	countryCode: v.optional(v.string()),

	status: v.union(
		v.literal('planning'),
		v.literal('confirmed'),
		v.literal('completed'),
		v.literal('cancelled')
	),

	summary: v.optional(v.string()),
	notes: v.optional(v.string())
})
	.index('by_campaignId', ['campaignId'])
	// The trip list is "soonest first" on both pages, so the common read is in
	// index order rather than a sort in the handler.
	.index('by_campaignId_and_startOn', ['campaignId', 'startOn'])
	.index('by_orgId_and_startOn', ['orgId', 'startOn']);

// Trip <-> project. Many-to-many: one trip visits several records, and the same
// record is visited again on next year's trip. Association is optional in both
// directions — a trip may exist before anyone has decided which families it
// reaches, and most records are never visited at all.
const tripProjects = defineTable({
	orgId: v.string(),
	tripId: v.id('trips'),
	projectId: v.id('projects'),
	// "Half day, morning only" — trip-specific, so it belongs on the link.
	note: v.optional(v.string())
})
	// unique(tripId, projectId)
	.index('by_tripId_and_projectId', ['tripId', 'projectId'])
	.index('by_tripId', ['tripId'])
	.index('by_projectId', ['projectId']);

// Who is going. The organization's own people — the `team` side of
// projectMembers.side — which is why this table exists at all rather than being
// more projectMembers rows.
const tripAttendees = defineTable({
	orgId: v.string(),
	tripId: v.id('trips'),
	// Carried directly, never reached by traversal — the same choice `tasks` and
	// `updates` make, and for the same reason: the campaign roster reads this by
	// campaign, and a query that had to traverse could pick up a row belonging
	// to another campaign.
	campaignId: v.id('campaigns'),
	contactId: v.id('contacts'),

	// Free text, same as projectMembers.role: "Coordinator", "Translator",
	// "Medic". This is the parenthetical in "Eman Hernandez (Coordinator)".
	role: v.optional(v.string()),
	// A flag rather than role === 'leader', because the Trip Leaders block is an
	// index lookup and `role` is free text an org spells however it likes.
	isLeader: v.boolean(),

	// Where this person is in going, which is a fact about THIS journey and not
	// about them: someone who declined December is still on the March roster.
	status: v.union(
		v.literal('invited'),
		v.literal('confirmed'),
		v.literal('declined'),
		v.literal('cancelled')
	),
	notes: v.optional(v.string())
})
	// unique(tripId, contactId) — keyed to the TRIP, not the campaign. A person
	// can go on several trips in the same campaign, so a (campaignId, contactId)
	// key would make the second trip a duplicate-key error or, worse, an
	// overwrite of the first trip's roster.
	.index('by_tripId_and_contactId', ['tripId', 'contactId'])
	.index('by_tripId', ['tripId'])
	.index('by_tripId_and_isLeader', ['tripId', 'isLeader'])
	.index('by_contactId', ['contactId'])
	.index('by_campaignId', ['campaignId']);

// One flight leg. A child table rather than airline/flightNumber columns on the
// trip, because nobody flies to Pakistan on one flight: it is DFW → DOH → ISB,
// and back. A single pair is wrong on the first real trip, and a second pair is
// wrong on the first trip with two connections.
const tripSegments = defineTable({
	orgId: v.string(),
	tripId: v.id('trips'),
	// Absent = the group itinerary. Present = this one person's own leg — one
	// attendee joins from another city, one stays a week longer and flies back
	// alone. One table rather than two, because every column is identical and
	// the trip page renders them in one list.
	attendeeId: v.optional(v.id('tripAttendees')),

	direction: v.union(v.literal('outbound'), v.literal('return')),
	// Leg order within a direction: DFW->DOH is 0, DOH->ISB is 1.
	order: v.number(),

	airline: v.string(),
	flightNumber: v.string(),
	// IATA, uppercased on write. Optional because a leg can be entered before
	// the routing is known.
	departureAirport: v.optional(v.string()),
	arrivalAirport: v.optional(v.string()),

	// LOCAL WALL CLOCK at the airport, 'YYYY-MM-DDTHH:mm' with NO zone suffix —
	// what is printed on the ticket, and what is rendered verbatim. Never parsed
	// with `new Date()`, which would silently reinterpret it in the server's or
	// the viewer's zone.
	//
	// The opposite treatment to tasks.dueOn and for the opposite reason: a due
	// date is a calendar day, but a departure is a real instant quoted to a
	// traveller in the departure airport's local time. Epoch ms alone would
	// render in the VIEWER's zone, so the coordinator in Tulsa would see a
	// departure time that appears nowhere on the ticket.
	departureAt: v.string(),
	arrivalAt: v.string(),
	// IANA ('America/Chicago'). The half that makes the wall clock computable:
	// durations, ordering across the date line, and "has it left yet" all resolve
	// through this. Optional, because a coordinator typing a ticket at midnight
	// should not be blocked on it — every consumer degrades to displaying the
	// wall clock and declining to compute.
	departureTimeZone: v.optional(v.string()),
	arrivalTimeZone: v.optional(v.string()),

	confirmationCode: v.optional(v.string()),
	notes: v.optional(v.string())
})
	.index('by_tripId', ['tripId'])
	.index('by_tripId_and_direction_and_order', ['tripId', 'direction', 'order'])
	.index('by_attendeeId', ['attendeeId']);

// What a trip PLANS to spend. Planned only: actuals live in the ledger, and the
// `allocations.tripId` that would attribute them is specified but not built —
// see PLAN-trips.md §7. Trip-owned data that nothing else reads or writes.
const tripBudgetLines = defineTable({
	orgId: v.string(),
	tripId: v.id('trips'),
	// "Airfare", "Lodging", "Ground transport", "Visas", "Insurance". Free text
	// with a suggested list, not a union: what a trip spends on is the org's
	// business, and a union is a schema change every time.
	label: v.string(),
	// Integer cents, always — the rule the whole ledger follows.
	amountCents: v.number(),
	// True when the amount is PER PERSON and the line total is amount x roster.
	// Airfare is quoted per seat and lodging per bed; a planner multiplying by
	// hand gets it wrong the first time somebody joins the trip, and gets it
	// wrong silently.
	perAttendee: v.boolean(),
	notes: v.optional(v.string()),
	order: v.number()
})
	.index('by_tripId', ['tripId'])
	.index('by_tripId_and_order', ['tripId', 'order']);

// A named set of budget lines a new trip can start from — "Standard Pakistan
// trip" as airfare, lodging, ground transport and visas, already priced.
//
// Deliberately NOT versioned, which is the one place this departs from
// `costTemplates` and `taskTemplates`. Those are append-only with an active
// version because a project's budget and a ticked checklist item must not be
// rewritten by a later edit to the thing they came from. Applying one of these
// COPIES its lines into `tripBudgetLines`, so the trip's own rows are the
// record from that moment on and there is nothing left to protect: editing the
// template afterwards cannot reach a trip that already used it, because no
// trip references it. No `isActive` either — a campaign may keep several
// (a one-week trip and a three-week one) and the planner picks.
//
// `lines` is inline for the same reason taskTemplates.items is: bounded at a
// handful of entries and always read as a whole.
const tripBudgetTemplates = defineTable({
	orgId: v.string(),
	campaignId: v.id('campaigns'),
	name: v.string(),
	lines: v.array(
		v.object({
			label: v.string(),
			// Integer cents, always — the rule the whole ledger follows.
			amountCents: v.number(),
			// Carried onto the copied line, so "per seat" survives the copy. A
			// preset that forgot this would silently price a twelve-person trip as
			// though one airfare covered everybody.
			perAttendee: v.boolean(),
			notes: v.optional(v.string()),
			order: v.number()
		})
	)
})
	.index('by_campaignId', ['campaignId'])
	.index('by_orgId', ['orgId']);

// ============================================================
// AI check-ins
// ============================================================
// A periodic conversation with a freed family — job, school, kids, wellbeing —
// that produces a DRAFT update for a person to review. See PLAN-ai-checkin.md.
//
// Four tables, and the split between them is the plan's §4 logging contract
// rather than a normalization exercise. The API is stateless and every call
// resends the whole context, so the log stores what was actually SENT, one row
// per model call, linked by conversation and turn. That is simultaneously the
// audit trail ("why did it say that") and the replay set: a new prompt version
// is tested by re-running real logged conversations against it before it ever
// reaches a family.
//
// Internal-only, for the same reason `trips` is: nothing here has an
// isPublished, a public query, or a site route. The one thing a check-in can
// put in front of the public is an `updates` row, and it can only ever write
// one as a DRAFT — the publish decision stays where it already is, behind
// `content:publish` and a second pair of eyes.

// ============================================================
// Agentic workflows
// ============================================================
// A workflow is a configured AI agent: which campaign it runs against, what
// starts it, what it must find out, what it writes back, how it speaks, and
// what shape its report takes. See PLAN-workflows.md.
//
// It replaces `checkinTemplates`, `updateFormats` and three org-wide
// `promptVersions` rows. Those were five independently-promotable things with
// nothing asserting they belonged together, so an admin could activate a set
// of objectives whose answers fed a report with no section for them and the
// system would run happily and draft badly. One object owns all of it.

/** One thing a workflow wants to find out. Shared by the draft and its snapshots. */
const workflowObjective = v.object({
	key: v.string(),
	label: v.string(),
	// The only text the judge sees. Describes a satisfying ANSWER, not a question.
	description: v.string(),
	// Per-objective overrides of RATING_ANSWERED / CONFIDENCE_ACCEPT.
	minRating: v.optional(v.number()),
	minConfidence: v.optional(v.number()),
	// Stop asking this one after N turns. MAX_RESPONDER_TURNS still bounds the
	// conversation as a whole.
	maxAttempts: v.optional(v.number()),
	skipIfKnown: v.optional(v.boolean()),
	// Household facts that must hold before this is asked at all. NOT the same
	// gate as skipIfKnown: that asks whether a field already holds the answer,
	// this asks whether the question applies to this family. Carrying the old
	// hardcoded hasChildren/hasSchoolAgeChildren rule across as data is the
	// reason it exists — see lib/domain/workflows.ts.
	requires: v.optional(
		v.array(v.union(v.literal('hasChildren'), v.literal('hasSchoolAgeChildren')))
	),
	// Absent, or `none`, means the answer is held for the report and filed
	// nowhere — the common case, and the reason the report exists.
	capture: v.optional(
		v.union(
			v.object({ kind: v.literal('none') }),
			v.object({
				kind: v.literal('field'),
				entity: v.union(v.literal('project'), v.literal('contact')),
				fieldKey: v.string(),
				options: v.optional(v.array(v.string()))
			})
		)
	)
});

/** A named group of objectives. A unit of AUTHORING, not a stage anyone is marched through. */
const workflowStep = v.object({
	key: v.string(),
	title: v.string(),
	entryMessage: v.optional(v.string()),
	objectives: v.array(workflowObjective)
});

/**
 * What the report is made of. `sections` becomes the draft_update tool's
 * input_schema at call time, so a section here is a section the draft WILL
 * have — enforced by the shape of a function call rather than requested in
 * prose the model may skim.
 */
const workflowReport = v.object({
	titleGuidance: v.string(),
	// Tone and house rules that are not structural. Appended to the drafter's
	// brief, never compiled into the prompt that protects the family.
	instructions: v.string(),
	sections: v.array(
		v.object({
			key: v.string(),
			label: v.string(),
			guidance: v.string(),
			approxWords: v.optional(v.number())
		})
	)
});

/**
 * The workflow's own voice. Per-workflow rather than org-wide, because a trip
 * debrief and a family check-in should not share a responder: the care about
 * who is being written to lives in that prompt, and it is not the same person.
 *
 * `content` is the whole system prompt, stored rather than referenced, for the
 * reason promptVersions gave: the code that produced it will have changed by
 * the time anyone reads the log.
 */
const workflowPrompt = v.object({
	content: v.string(),
	// The model this wording was written against. Not a runtime setting — the
	// same words behave differently on a different tier, so "which prompt" and
	// "which model" are one fact for replay purposes.
	model: v.string()
});

/**
 * What starts a run.
 *
 *   manual        — a person starts it on a record. What exists today.
 *   stage_change  — a record entering a named pipeline stage. Stages are
 *                   already data with a `key`, so this is a hook in the
 *                   mutation that moves a record, not new infrastructure.
 *   schedule      — every N months. The field exists; no cron reads it yet,
 *                   deliberately (PLAN-workflows.md §5).
 */
const workflowTrigger = v.union(
	v.object({ kind: v.literal('manual') }),
	v.object({ kind: v.literal('stage_change'), stageKey: v.string() }),
	v.object({ kind: v.literal('schedule'), everyMonths: v.number() })
);

/**
 * The editable draft. One row per workflow, patched freely.
 *
 * NO isActive, unlike taskTemplates and promptVersions, and that is the point
 * of the draft/version split rather than an omission. Those tables answer "of
 * these interchangeable versions, which one is live" — there is one checklist
 * per campaign and one responder per org. A campaign may want a family
 * check-in AND a trip debrief running side by side, so workflows do not
 * compete for a slot and there is nothing to deactivate. What `status`
 * records is whether THIS workflow has been published, not whether it won.
 */
const workflows = defineTable({
	orgId: v.string(),
	// Required, unlike checkinTemplates.campaignId which allowed an org-wide
	// default. A workflow names the records it runs against by campaign, and
	// "all campaigns" would mean a family check-in firing on a trip.
	campaignId: v.id('campaigns'),

	name: v.string(),
	description: v.optional(v.string()),

	trigger: workflowTrigger,
	steps: v.array(workflowStep),
	report: workflowReport,
	prompts: v.object({
		responder: workflowPrompt,
		judge: workflowPrompt,
		drafter: workflowPrompt
	}),

	//   draft     — never published. Editable, and deletable outright.
	//   published — has a version runs may bind to. Still editable; edits land
	//               in the next version, not in the one already running.
	//   archived  — hidden from pickers, versions kept. What "delete" means
	//               once a run names one of its versions.
	status: v.union(v.literal('draft'), v.literal('published'), v.literal('archived')),

	// The version new runs bind to. Absent until first publish. A pointer
	// rather than a flag on the version rows, so promoting is one write and
	// two versions can never both believe they are current.
	currentVersionId: v.optional(v.id('workflowVersions'))
})
	.index('by_orgId', ['orgId'])
	.index('by_campaignId', ['campaignId'])
	.index('by_campaignId_and_status', ['campaignId', 'status']);

/**
 * An immutable published snapshot. Written on publish, never patched.
 *
 * This is where the append-only contract that costTemplates, taskTemplates and
 * promptVersions all state now lives — and it is finally at the right
 * altitude. Those tables froze AUTHORING, so a workflow nobody had ever run
 * could not be edited either. Freezing belongs to the act of running: a
 * version a run names must not change, because the log is also the replay set
 * (PLAN-ai-checkin.md §5), and a replay against a moved goalpost proves
 * nothing. A draft nobody has run protects nothing by being immutable.
 *
 * The snapshot is a VALUE COPY, on the `budgets`/`costTemplates` precedent:
 * everything needed to run and to replay is here, so reading a run's
 * configuration never joins back to a draft that has since moved on.
 */
const workflowVersions = defineTable({
	orgId: v.string(),
	workflowId: v.id('workflows'),
	campaignId: v.id('campaigns'),
	// Monotonic per workflow, starting at 1. A number rather than 'v1' because
	// nothing here parses it and ordering is the only thing asked of it.
	version: v.number(),
	publishedAt: v.number(),
	// Better Auth user id. Who put these words in front of families.
	publishedByUserId: v.string(),

	name: v.string(),
	trigger: workflowTrigger,
	steps: v.array(workflowStep),
	report: workflowReport,
	prompts: v.object({
		responder: workflowPrompt,
		judge: workflowPrompt,
		drafter: workflowPrompt
	})
})
	// unique(workflowId, version)
	.index('by_workflowId_and_version', ['workflowId', 'version'])
	.index('by_workflowId', ['workflowId'])
	.index('by_campaignId', ['campaignId'])
	.index('by_orgId', ['orgId']);

// One check-in with one family.
//
// The OBJECTIVE SET IS SNAPSHOTTED here, the same contract budgets keep with
// costTemplates: changing the default objectives must not retroactively change
// what a logged conversation was asking, or the replay set is measuring a
// moved goalpost rather than a prompt change.
const checkinConversations = defineTable({
	orgId: v.string(),
	// Carried directly, never traversed — the same choice tasks, updates and
	// tripAttendees make, and for the same reason: the admin list reads by
	// campaign, and a query that traversed could pick up another campaign's row.
	campaignId: v.id('campaigns'),

	// The record this is about, when it is about one.
	//
	// OPTIONAL, because a conversation can be with anyone in the campaign — a
	// sponsor, a trip attendee, a staff member — and most of those people are
	// not on a record at all. `campaignId` is the only parent every conversation
	// has, which is why it is the required one.
	//
	// A CHECK-IN still requires it. The engine builds its family profile from a
	// record and its objectives are about a household, so
	// `startCheckinOnConversation` refuses without one — you can message a
	// sponsor, you cannot run a family check-in on them.
	projectId: v.optional(v.id('projects')),

	// Who is actually being messaged. Optional in the other direction: a
	// conversation can be opened against a record before anyone has decided
	// which member holds the phone. Cleared rather than cascaded if that contact
	// is deleted — the transcript is still the record of what was said.
	//
	// At least one of `projectId` and `contactId` is always set; the mutations
	// enforce it, because a conversation with neither is addressed to nobody.
	contactId: v.optional(v.id('contacts')),

	// What kind of conversation this is.
	//
	//   direct  — people talking. Staff write the outbound messages, replies are
	//             recorded against it, and no model is ever called.
	//   checkin — the engine owns it: objectives, a responder, a judge, a turn
	//             cap, and a draft at the end.
	//
	// ONE TABLE rather than two, because they are the same thread. A check-in
	// started on a conversation that already has messages in it should see those
	// messages — a responder writing to a family a staff member spoke to last
	// week must not open by introducing itself. Splitting them would make that
	// one transcript into two and force every reader to stitch them.
	//
	// Absent means `checkin`: every row written before this column existed was
	// one, and reading those as `direct` would take them away from the engine
	// that is mid-conversation with them.
	kind: v.optional(v.union(v.literal('direct'), v.literal('checkin'))),

	status: v.union(
		v.literal('open'),
		// Waiting on a person: a low-confidence reading, a conversation that ran
		// out of turns, or a drafting call that did not produce a draft.
		v.literal('needs_review'),
		// A person is handling this family directly. Terminal for the machine.
		v.literal('escalated'),
		v.literal('drafted'),
		v.literal('closed')
	),
	// Set alongside `needs_review`, so the queue can say what it wants.
	reviewReason: v.optional(
		v.union(
			v.literal('low_confidence'),
			v.literal('exhausted'),
			v.literal('draft_failed'),
			// A call was refused, truncated, or came back without its forced tool
			// call. Written by the action, not by the engine's stopping rule.
			v.literal('model_error')
		)
	),

	// The frozen objective set. Inline rather than a child table for the same
	// reason taskTemplates.items is: bounded at a handful, always read whole,
	// and meaningless apart from its parent.
	//
	// OPTIONAL, because a `direct` conversation is not asking anything. It is
	// written when a check-in starts — either at open, or later on a
	// conversation that began as people talking.
	objectives: v.optional(
		v.array(
			v.object({
				key: v.string(),
				label: v.string(),
				description: v.string(),
				// Carried on the SNAPSHOT, not read from the template at judge
				// time — a threshold promoted mid-conversation would re-grade
				// answers that were already scored under the old one.
				minRating: v.optional(v.number()),
				minConfidence: v.optional(v.number()),
				maxAttempts: v.optional(v.number()),
				capture: v.optional(
					v.union(
						v.object({ kind: v.literal('none') }),
						v.object({
							kind: v.literal('field'),
							entity: v.union(v.literal('project'), v.literal('contact')),
							fieldKey: v.string(),
							options: v.optional(v.array(v.string()))
						})
					)
				)
			})
		)
	),

	// Which prompts this conversation is bound to, frozen when the check-in
	// starts. A prompt promoted mid-conversation must not change the voice
	// halfway through. Absent on a `direct` conversation, which calls no model.
	// The published workflow version this run is bound to, frozen at open.
	// ONE id where there were five independently-promotable version strings that
	// could disagree: objectives resolved from template A, a report drafted
	// against format B, and three org-wide prompts that knew about neither.
	// Absent on a `direct` conversation, which runs nothing.
	workflowVersionId: v.optional(v.id('workflowVersions')),

	// 'en' | 'es'. Free text rather than a union: the escalation scanner reports
	// which locales it can actually read, and a conversation in a third one is a
	// thing to route to a person, not a value to reject at the schema.
	locale: v.string(),

	// Responder calls made. The turn cap reads this rather than counting rows,
	// so an interrupted turn cannot buy the conversation an extra question.
	turnsSpent: v.number(),

	openedAt: v.number(),
	lastMessageAt: v.optional(v.number()),
	closedAt: v.optional(v.number()),
	// The draft this conversation produced, if it got that far.
	updateId: v.optional(v.id('updates'))
})
	.index('by_projectId', ['projectId'])
	.index('by_projectId_and_status', ['projectId', 'status'])
	.index('by_campaignId_and_status', ['campaignId', 'status'])
	// The inbox's default order: most recent activity first. Without it the
	// unfiltered campaign read ranges on `campaignId` alone against the index
	// above, and Convex then orders by the NEXT key — `status` — so the queue
	// comes back sorted alphabetically by state. `lastMessageAt` is stamped at
	// open so a conversation nobody has written in yet still sorts.
	.index('by_campaignId_and_lastMessageAt', ['campaignId', 'lastMessageAt'])
	.index('by_orgId_and_status', ['orgId', 'status'])
	// The contact cascade's only bounded way in. `contactId` is optional, so
	// this index also ranges over the rows that have none — which is fine,
	// because the cascade pins an actual id.
	.index('by_contactId', ['contactId'])
	.index('by_orgId', ['orgId']);

// What was actually said, in order.
//
// NOT in PLAN-ai-checkin.md §4, and added deliberately. The plan's three tables
// are the DECISION trace — what was sent to a model and what came back. The
// transcript is a different fact, and the only other place it exists is
// embedded inside each responder call's `input`, mixed with the profile and the
// outstanding-objective list in whatever shape that prompt version happened to
// use.
//
// Reconstructing the conversation by parsing prompts would make every reader —
// the engine, the admin transcript view, the replay harness — depend on a
// prompt's formatting, which is the one thing this design guarantees will
// change. So the messages are stored as messages.
//
// It is also the seam the WhatsApp transport plugs into (§6, out of scope):
// `outbound` rows are what something else sends, `inbound` rows are what it
// delivers back.
const checkinMessages = defineTable({
	orgId: v.string(),
	conversationId: v.id('checkinConversations'),
	direction: v.union(v.literal('outbound'), v.literal('inbound')),
	text: v.string(),

	// Better Auth user id, on outbound messages a PERSON wrote.
	//
	// Absent means the engine wrote it. The distinction is not bookkeeping: a
	// transcript where a staff member cannot tell their own words from a model's
	// is a transcript they cannot answer questions about, and the person who has
	// to explain what the charity said to a family is the one reading it.
	authorUserId: v.optional(v.string()),
	// The responder turn this belongs to. An inbound message carries the turn it
	// will be processed as, so a message and the ratings it produced line up.
	turnNumber: v.number(),
	at: v.number()
})
	.index('by_conversationId_and_at', ['conversationId', 'at'])
	.index('by_conversationId', ['conversationId'])
	.index('by_orgId', ['orgId']);

// The DECISION trace: every row is one model call, with the full input that
// produced it. §4 is explicit that this stores what was sent rather than
// deltas.
//
// `input` can be large — the responder's context is the family profile plus the
// whole conversation. It is bounded by the turn cap and by the fact that a
// WhatsApp conversation is a few hundred words, so it stays far inside the 1MB
// document limit; `model/checkins.ts` truncates rather than letting a write
// fail, because losing the log entry is worse than losing its tail.
const conversationTurns = defineTable({
	orgId: v.string(),
	conversationId: v.id('checkinConversations'),
	// Denormalized so the per-family audit view is one indexed read rather than
	// a join through every conversation the family has had. Optional for the
	// same reason the conversation's own is: a turn only exists on a check-in,
	// which always names a record, but the column mirrors its parent rather
	// than asserting something the parent does not guarantee.
	projectId: v.optional(v.id('projects')),
	turnNumber: v.number(),
	role: v.union(v.literal('responder'), v.literal('judge')),
	promptVersion: v.string(),
	// The model that actually served it, read off the response rather than off
	// config — config is what we asked for, this is what answered.
	model: v.string(),
	input: v.string(),
	output: v.string(),
	latencyMs: v.number(),
	inputTokens: v.optional(v.number()),
	outputTokens: v.optional(v.number()),
	// Set instead of `output` when the call failed. A failed call is part of the
	// trace — "it did not respond" is an answer to "why did it respond that way".
	error: v.optional(v.string())
})
	.index('by_conversationId_and_turnNumber', ['conversationId', 'turnNumber'])
	.index('by_conversationId', ['conversationId'])
	.index('by_projectId', ['projectId'])
	.index('by_orgId', ['orgId']);

// One judge rating, per objective, per turn.
//
// A separate table from conversationTurns even though every row comes from a
// judge row, because these are what the whole engine reads: "which objectives
// are still outstanding" is a query over this table, and answering it by
// parsing JSON out of a turn's `output` would make the engine's control flow
// depend on a log format.
const objectiveChecks = defineTable({
	orgId: v.string(),
	conversationId: v.id('checkinConversations'),
	turnNumber: v.number(),
	// A key from the conversation's snapshotted objective set.
	objective: v.string(),
	// The judge SCHEMA version that produced this, which is the judge prompt's
	// version — the rating and the wording that asked for it travel together.
	promptVersion: v.string(),
	rating: v.number(),
	// NULLABLE, and that is the point: forced tool use guarantees the shape of
	// what comes back, not its truth, so the schema has to give the model
	// somewhere to put "they have not said" other than a plausible sentence.
	answer: v.union(v.string(), v.null()),
	confidence: v.number()
})
	.index('by_conversationId', ['conversationId'])
	.index('by_conversationId_and_objective', ['conversationId', 'objective'])
	.index('by_orgId', ['orgId']);

// A family said something that needs a person, now.
//
// Its own table rather than a flag on the conversation because it is a QUEUE
// someone works, with its own resolution state, and because one conversation
// can raise more than one — "violence and self-harm" is a different phone call
// from either alone.
//
// Written by the same deterministic scan that stops the conversation, in the
// same mutation, before any model call is scheduled. There is no path that
// escalates without a row and no path that writes a row without stopping.
const checkinEscalations = defineTable({
	orgId: v.string(),
	conversationId: v.id('checkinConversations'),
	// Absent when the conversation is with a person rather than about a record.
	// An escalation is raised on ANY inbound message, including one from a
	// sponsor — the scanner does not ask who is talking before it decides
	// somebody needs a person.
	projectId: v.optional(v.id('projects')),
	campaignId: v.id('campaigns'),
	// Which incoming message tripped it, by turn number.
	turnNumber: v.number(),
	category: v.union(
		v.literal('violence'),
		v.literal('abuse'),
		v.literal('self_harm'),
		v.literal('trafficking'),
		v.literal('medical_emergency'),
		v.literal('child_danger')
	),
	// The phrase from the scanner's list that matched, normalized. The audit
	// trail for "why did this fire", and the input to tuning the list.
	term: v.string(),
	// A short quotation around the match. A POINTER to the transcript, not a
	// copy of it — prose about a named family lives in one place.
	excerpt: v.string(),
	status: v.union(v.literal('open'), v.literal('acknowledged'), v.literal('resolved')),
	// Better Auth user id.
	acknowledgedBy: v.optional(v.string()),
	acknowledgedAt: v.optional(v.number()),
	resolvedBy: v.optional(v.string()),
	resolvedAt: v.optional(v.number()),
	note: v.optional(v.string())
})
	.index('by_orgId_and_status', ['orgId', 'status'])
	.index('by_campaignId_and_status', ['campaignId', 'status'])
	.index('by_conversationId', ['conversationId'])
	.index('by_projectId', ['projectId']);

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
	orgContactTotals,
	contactEmails,
	contactPhones,
	contactAddresses,
	contactBackgroundChecks,
	households,
	householdMembers,
	projectMembers,
	trips,
	tripProjects,
	tripAttendees,
	tripSegments,
	tripBudgetLines,
	tripBudgetTemplates,
	customFieldCategories,
	customFieldDefinitions,
	campaignAssignments,
	campaignMemberships,
	workflows,
	workflowVersions,
	checkinConversations,
	checkinMessages,
	conversationTurns,
	objectiveChecks,
	checkinEscalations
});
