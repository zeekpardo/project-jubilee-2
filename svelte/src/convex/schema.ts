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
	attributes: v.record(v.string(), attributeValue)
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
	note: v.optional(v.string())
})
	.index('by_orgId', ['orgId'])
	.index('by_orgId_and_type', ['orgId', 'type'])
	.index('by_orgId_and_occurredOn', ['orgId', 'occurredOn'])
	.index('by_contactId', ['contactId']);

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
	// Donor-only preferences, carried over from the retired sponsors table.
	transparency: v.optional(v.union(v.literal('summary'), v.literal('full'))),
	preferredContact: v.optional(v.union(v.literal('email'), v.literal('mail'), v.literal('phone'))),
	invitedAt: v.optional(v.number())
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
	projects,
	budgets,
	documents,
	transactions,
	allocations,
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
