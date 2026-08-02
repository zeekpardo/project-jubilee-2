/**
 * Project Jubilee seed — the PURE transformation layer.
 *
 * This module is a faithful port of the transformation half of the reference
 * Postgres/Drizzle seed (`next-shadcn-dashboard-starter/scripts/seed.ts`). It
 * takes the four source JSON documents and returns a fully-resolved `SeedPlan`:
 * every row the seed will write, already in our schema's shape.
 *
 * Deliberately free of Convex, Node and `$lib` imports so that BOTH sides can
 * use it — the Convex mutations in `./jubilee.ts` (for the constants) and the
 * Node driver in `scripts/seed-jubilee.ts` (for the whole plan, which is what
 * makes `--dry-run` possible without touching the database).
 *
 * The source JSON contains real personal data and lives OUTSIDE this repo. It
 * is never vendored here; only the shapes and the transformation rules are.
 */

// ---------------------------------------------------------------------------
// Input types (shape of the extracted xlsx / doc JSON)
// ---------------------------------------------------------------------------

export interface FamilyRow {
	number: string;
	raw_name: string;
	note: string;
	link: string;
	debt: number | null;
	fixed: Record<string, number | null>;
	grand_total: number | null;
	milestones: Record<string, string | number | null>;
	sponsor: { name: string | null; email: string | null; phone: string | null };
	row: number;
	family_name: string;
	name_extra: string[];
	template_version: string | null;
}

/**
 * Per-family profile from the org's "Family Profiles" doc. Only the fields the
 * seed actually consumes are declared: the source rows carry extras
 * (`amount_raw`, `duration_raw`, `family_size`, `link`) that the reference
 * ignores, and leaving them undeclared is what stops them leaking into the
 * attributes bag by accident.
 */
export interface ProfileRow {
	number: string;
	status: string | null;
	family_name: string | null;
	years_enslaved: number | null;
	reason: string | null;
	religion: string | null;
	members: { name: string; relationship: string | null }[];
	photo: string | null;
}

export interface ReceivedRow {
	amount: number;
	date: string | null;
	purpose: string | null;
	row: number;
}

export interface SentRow extends ReceivedRow {
	method: string | null;
}

export interface PkSpendRow {
	label: string;
	amount: number;
	fund: string;
	row: number;
}

export interface TransactionsFile {
	received: ReceivedRow[];
	sent: SentRow[];
	pk_spend: PkSpendRow[];
}

export interface FamilySponsorsFile {
	family_sponsors: Record<string, string>;
	sponsor_details: Record<
		string,
		{ email?: string; phone?: string; organization?: string; city?: string; state?: string }
	>;
	fully_funded: string[];
}

export interface SeedInput {
	families: FamilyRow[];
	profiles: ProfileRow[];
	sponsors: FamilySponsorsFile;
	transactions: TransactionsFile;
}

// ---------------------------------------------------------------------------
// Output types (the plan — one entry per row we intend to write)
// ---------------------------------------------------------------------------

export type AttributeValue = string | number | boolean | null;

export interface StageRow {
	key: string;
	label: string;
	order: number;
	kind: 'funnel' | 'terminal';
	accent: string;
	isDefault: boolean;
	isFundedGate: boolean;
	isSystem: boolean;
}

export interface FieldDefinitionRow {
	key: string;
	label: string;
	type: 'text' | 'longtext' | 'number' | 'money' | 'date' | 'select' | 'boolean';
	order: number;
	isRequired: boolean;
	isPublic: boolean;
}

export interface TaskTemplateItem {
	key: string;
	label: string;
	order: number;
	/**
	 * Free text; absent means the item feeds no stat. Where the tag's stat
	 * shows lives on the campaign's publicStats row, not here.
	 */
	impactTag?: string;
}

export interface ProjectRow {
	number: string;
	name: string;
	stage: string;
	story?: string;
	attributes: Record<string, AttributeValue>;
	isPublished: boolean;
	publishedAt?: number;
	isGoalMet: boolean;
	goalMetAt?: number;
}

export interface BudgetRow {
	projectNumber: string;
	templateVersion: string;
	templateSnapshot: Record<string, number>;
	debtCents: number;
	/**
	 * The sheet's `grand_total × 100`, which stays AUTHORITATIVE for
	 * `targetCents` — exactly as in the reference. `budgetTarget()` is computed
	 * by the driver only to log a variance, never to overwrite this.
	 */
	targetCents: number;
}

export interface DocumentRow {
	projectNumber: string;
	stage: string;
	kind: 'debt_evidence' | 'receipt' | 'legal_certificate' | 'photo' | 'agreement' | 'other';
	notes?: string;
}

export interface MemberRow {
	remoteId: string;
	firstName: string;
	lastName?: string;
	/** The relationship as recorded in the profile doc, e.g. "head". */
	relationship?: string;
	householdRole: 'parent_guardian' | 'adult' | 'other_adult' | 'child';
}

export interface HouseholdGroup {
	projectNumber: string;
	householdName: string;
	members: MemberRow[];
}

export interface SponsorRow {
	remoteId: string;
	firstName: string;
	lastName?: string;
	email?: string;
	phone?: string;
	organization?: string;
	city?: string;
	state?: string;
	links: { projectNumber: string; status: 'paid' | 'committed' }[];
}

export interface AllocationRow {
	/** Absent means a campaign-level (project-less) allocation. */
	projectNumber?: string;
	amountCents: number;
}

export interface TransactionRow {
	/**
	 * Seed provenance marker, stored in `transactions.note`. Our schema has no
	 * `sourceBlock`/`sourceRow` columns like the reference's, so the marker
	 * carries that provenance AND doubles as the seed's idempotency key and the
	 * only thing that makes a transaction identifiable as seed-owned (a
	 * transaction has no campaignId, so the wipe cannot scope it any other way).
	 */
	note: string;
	type: 'donation' | 'transfer' | 'expenditure';
	amountCents: number;
	occurredOn?: string;
	method?: string;
	reference?: string;
	allocations: AllocationRow[];
}

/**
 * One family photo to upload into Convex storage. `file` is the bare filename
 * from the profile doc; the bytes live OUTSIDE this repo (identifiable photos
 * of vulnerable people) and are read from JUBILEE_PHOTOS_DIR at run time.
 */
export interface PhotoRow {
	projectNumber: string;
	file: string;
}

export interface SeedPlan {
	campaign: typeof JUBILEE_CAMPAIGN;
	orgSettings: typeof JUBILEE_ORG_SETTINGS;
	stages: StageRow[];
	costTemplates: { version: string; lineItems: Record<string, number> }[];
	taskTemplate: {
		version: string;
		effectiveFrom: string;
		isActive: boolean;
		items: TaskTemplateItem[];
	};
	fieldCategory: { name: string; order: number };
	fieldDefinitions: FieldDefinitionRow[];
	projects: ProjectRow[];
	budgets: BudgetRow[];
	documents: DocumentRow[];
	households: HouseholdGroup[];
	sponsors: SponsorRow[];
	transactions: TransactionRow[];
	photos: PhotoRow[];
	/** Diagnostics the driver prints; none of these abort the run. */
	notes: {
		stageCounts: Record<string, number>;
		fundedAllocations: number;
		catchAllAllocations: number;
		fundedShortfallCents: number;
		/** How the source `link` column was routed. See `routeFamilyLink`. */
		linkCounts: {
			managedMissions: number;
			payment: number;
			/** Cells holding something other than a URL — never linked. */
			nonUrl: number;
			/** Looked like a URL but would not parse — never linked. */
			unparsed: number;
		};
		/**
		 * host → count for everything that landed in `payment_link`, so a host the
		 * seed has not seen before shows up in the report instead of vanishing into
		 * a field nobody looks at.
		 */
		paymentLinkHosts: Record<string, number>;
	};
}

// ---------------------------------------------------------------------------
// Seed-ownership markers
// ---------------------------------------------------------------------------

/** Prefix on `transactions.note` marking a row as owned by this seed. */
export const SEED_TRANSACTION_NOTE_PREFIX = 'seed:jubilee/';

/** Prefix on `contacts.remoteId` marking a person as created by this seed. */
export const SEED_CONTACT_REMOTE_ID_PREFIX = 'jubilee-seed:';

/** The campaign every seeded row hangs off, resolved by slug (ids can't be forced). */
export const JUBILEE_CAMPAIGN_SLUG = 'project-jubilee';

// ---------------------------------------------------------------------------
// Fixed configuration (ported from the reference's constants)
// ---------------------------------------------------------------------------

export const JUBILEE_CAMPAIGN = {
	name: 'Project Jubilee',
	slug: JUBILEE_CAMPAIGN_SLUG,
	status: 'active' as const,
	numberPrefix: 'P',
	objectLabel: 'Family',
	objectLabelPlural: 'Families',
	membersEnabled: true,
	budgetShape: 'template' as const,
	goalLabel: 'Freed',
	goalVerb: 'freed',
	goalTrigger: 'manual' as const,
	isPublished: true
};

export const JUBILEE_ORG_SETTINGS = {
	slug: 'jubilee',
	theme: 'jubilee',
	publicName: 'Project Jubilee',
	publicTagline:
		"Freeing families from debt bondage in Pakistan's brick kilns — paying their debt in full, then walking with them into a free life."
};

/** The protected system stages seeded into `pipelineStages` for the campaign. */
export const SYSTEM_PIPELINE_STAGES: StageRow[] = [
	{
		key: 'identified',
		label: 'Identified',
		order: 1,
		kind: 'funnel',
		accent: 'slate',
		isDefault: true,
		isFundedGate: false,
		isSystem: true
	},
	{
		key: 'vetted',
		label: 'Vetted',
		order: 2,
		kind: 'funnel',
		accent: 'sky',
		isDefault: false,
		isFundedGate: false,
		isSystem: true
	},
	{
		key: 'published',
		label: 'Published',
		order: 3,
		kind: 'funnel',
		accent: 'violet',
		isDefault: false,
		isFundedGate: false,
		isSystem: true
	},
	{
		key: 'funded',
		label: 'Funded',
		order: 4,
		kind: 'funnel',
		accent: 'amber',
		isDefault: false,
		isFundedGate: true,
		isSystem: true
	},
	{
		key: 'cancelled',
		label: 'Cancelled',
		order: 5,
		kind: 'terminal',
		accent: 'red',
		isDefault: false,
		isFundedGate: false,
		isSystem: true
	},
	{
		key: 'freed_by_other',
		label: 'Freed by other',
		order: 6,
		kind: 'terminal',
		accent: 'stone',
		isDefault: false,
		isFundedGate: false,
		isSystem: true
	}
];

const BASE_LINE_ITEMS = {
	rent_cents: 30000,
	food_cents: 15000,
	pastor_lawyer_cents: 10000,
	photographer_cents: 15000,
	ground_work_cents: 7500,
	tuktuk_cents: 201000,
	transaction_fees_cents: 54000
};

export const COST_TEMPLATES: Record<string, Record<string, number>> = {
	'v1-school705-admin0': { ...BASE_LINE_ITEMS, school_cents: 70500, admin_cents: 0 },
	'v2-school705-admin500': { ...BASE_LINE_ITEMS, school_cents: 70500, admin_cents: 50000 },
	'v3-school1323-admin500': { ...BASE_LINE_ITEMS, school_cents: 132300, admin_cents: 50000 }
};

export const TASK_TEMPLATE_VERSION = 'v1-2026';
export const TASK_TEMPLATE_EFFECTIVE_FROM = '2026-01-01';
// `impactTag` decides whether an item feeds a stat at all. Most items carry
// none — they are operational work. Several items can share a tag; the stat
// counts distinct records, so a family with a tuktuk AND a sewing machine
// counts once toward `business`.
export const TASK_TEMPLATE_ITEMS: TaskTemplateItem[] = [
	{ key: 'debt_paid', label: 'Debt paid', order: 1 },
	{
		key: 'certificate_of_freedom',
		label: 'Certificate of freedom',
		order: 2,
		// Tagged but NOT public: a useful internal metric that is nobody else's
		// business.
		impactTag: 'legal_certificate'
	},
	{
		key: 'tuktuk_delivered',
		label: 'TukTuk delivered',
		order: 3,
		impactTag: 'business'
	},
	{
		key: 'school_enrolled',
		label: 'Children enrolled in school',
		order: 4,
		impactTag: 'school'
	},
	{
		key: 'sewing_machine',
		label: 'Sewing machine provided',
		order: 5,
		impactTag: 'business'
	},
	{ key: 'housing_secured', label: 'Housing secured', order: 6 },
	{ key: 'pastor_assigned', label: 'Pastor assigned', order: 7 },
	{ key: 'follow_up', label: 'Follow-up check-in', order: 8 }
];

export const JUBILEE_DETAILS_CATEGORY = { name: 'Details', order: 0 };

export const JUBILEE_FIELD_DEFINITIONS: FieldDefinitionRow[] = [
	{
		key: 'years_enslaved',
		label: 'Years enslaved',
		type: 'number',
		order: 1,
		isRequired: false,
		isPublic: true
	},
	{
		key: 'reason_for_enslavement',
		label: 'Reason for enslavement',
		type: 'text',
		order: 2,
		isRequired: false,
		isPublic: true
	},
	{
		key: 'religion',
		label: 'Religion',
		type: 'text',
		order: 3,
		isRequired: false,
		isPublic: false
	},
	// The sheet's `link` column, split by host. Internal like Religion: these are
	// operational back-office links, not something the donor site should show.
	// Our field-type union has no `url`, so both are plain `text`.
	{
		key: 'managed_missions_link',
		label: 'Managed Missions link',
		type: 'text',
		order: 4,
		isRequired: false,
		isPublic: false
	},
	{
		key: 'payment_link',
		label: 'Payment link',
		type: 'text',
		order: 5,
		isRequired: false,
		isPublic: false
	}
];

/**
 * P-040…P-046 were freed by ANOTHER organization (sheet legend row 6). They are
 * recorded as a terminal off-ramp so the pipeline reflects reality.
 */
export const FREED_BY_OTHER = new Set([
	'P-040',
	'P-041',
	'P-042',
	'P-043',
	'P-044',
	'P-045',
	'P-046'
]);

export const FREED_BY_OTHER_NOTE =
	'Freed by another organization (recorded from the source spreadsheet).';

/** Passthrough allocation buckets — campaign-level, never a project. */
export const PASSTHROUGH_SLUGS = new Set(['other-projects', 'family-batch-unallocated']);

const CATCH_ALL_SLUG = 'family-batch-unallocated';

/** Stages that seed as publicly visible on the donor site. */
const PUBLIC_STAGES = new Set(['published', 'funded']);

// The xlsx carries no per-family publish/rescue dates; placeholders make
// public-stage families visible through the privacy wall.
export const PLACEHOLDER_PUBLISHED_AT = Date.parse('2025-06-01T00:00:00Z');
export const PLACEHOLDER_GOAL_MET_AT = Date.parse('2025-09-01T00:00:00Z');

/** Sheet milestone key → the stage-evidence document a DONE step produces. */
const DOCUMENT_MAP: Record<string, { stage: string; kind: DocumentRow['kind']; notes?: string }> = {
	funded: { stage: 'funded', kind: 'other' },
	transferred: { stage: 'funded', kind: 'other', notes: 'Transferred' },
	sent: { stage: 'funded', kind: 'other', notes: 'Sent to field' },
	paid_debt_ground: { stage: 'funded', kind: 'receipt', notes: 'Debt paid' },
	tuktuk: { stage: 'funded', kind: 'receipt', notes: 'Tuk-tuk delivered' },
	mercy_house: { stage: 'funded', kind: 'other', notes: 'Mercy House' }
};

// ---------------------------------------------------------------------------
// Helpers (each a direct port; see the reference for the original comments)
// ---------------------------------------------------------------------------

/** Dollars → integer cents, rounding half up consistently. */
export function toCents(amount: number): number {
	return Math.round(amount * 100);
}

export function isYes(value: unknown): boolean {
	return typeof value === 'string' && value.trim().toLowerCase() === 'yes';
}

export function isNo(value: unknown): boolean {
	return typeof value === 'string' && value.trim().toLowerCase() === 'no';
}

/** Milestone cell → status, or null when the cell carries no signal. */
export function milestoneStatus(value: string | number | null): 'done' | 'pending' | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') return 'done'; // paid amounts recorded in the cell
	if (isYes(value)) return 'done';
	if (isNo(value)) return 'pending';
	return null; // stray text (e.g. a sponsor name typed into the column)
}

export function normalizeName(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve a family's display name, patching a known extraction quirk: some rows
 * (e.g. P-006) have a blank `raw_name` but carry a name-like string in the
 * `link` column instead of a URL. Without this, `family_name` falls back to the
 * family number and renders as the undignified "The P-006 family".
 */
export function resolveFamilyName(f: FamilyRow): string {
	const rawNameEmpty = !f.raw_name || f.raw_name.trim() === '';
	const link = f.link ? f.link.trim() : '';
	const linkLooksLikeUrl = link !== '' && /^https?:\/\//i.test(link);
	if (rawNameEmpty && link !== '' && !linkLooksLikeUrl) {
		const firstSegment = link.split('/')[0].trim();
		if (firstSegment) return firstSegment;
	}
	return f.family_name;
}

/**
 * The Managed Missions host, matched as a DOMAIN SUFFIX (`x.managedmissions.com`
 * and the bare apex both count, `notmanagedmissions.com` does not). A suffix
 * test rather than an equality test because the org's tenant subdomain is not
 * something this seed should be pinned to — and the leading dot is what keeps
 * the suffix honest.
 */
const MANAGED_MISSIONS_HOST = 'managedmissions.com';

export type LinkFieldKey = 'managed_missions_link' | 'payment_link';

export interface FamilyLink {
	field: LinkFieldKey;
	url: string;
	/** Lower-cased hostname, so the driver can surface an unrecognised host. */
	host: string;
}

/**
 * Route a family's `link` cell to one of the two link custom fields.
 *
 * The column is NOT clean: a handful of rows carry a name or a scrap of text
 * instead of a URL, which `resolveFamilyName` consumes as the family's name.
 * Those must never become links, so the SAME url test is used here — the two
 * functions have to agree on what counts as a URL or a family would end up both
 * named after its link and linked to its name.
 *
 * Returns null for an empty cell, a non-URL cell, or a URL-looking string that
 * will not parse. Anything that parses but is not a Managed Missions host goes
 * to `payment_link` rather than being dropped; the driver prints the hosts it
 * routed there so an unseen one is visible.
 */
export function routeFamilyLink(link: string | null | undefined): FamilyLink | null {
	const value = link ? link.trim() : '';
	if (value === '' || !/^https?:\/\//i.test(value)) return null;
	let host: string;
	try {
		host = new URL(value).hostname.toLowerCase();
	} catch {
		return null;
	}
	const isManagedMissions =
		host === MANAGED_MISSIONS_HOST || host.endsWith(`.${MANAGED_MISSIONS_HOST}`);
	return {
		field: isManagedMissions ? 'managed_missions_link' : 'payment_link',
		url: value,
		host
	};
}

/** Canonicalize religion strings (the doc has a truncated "Christia"). */
export function normalizeReligion(value: string | null | undefined): string | null {
	if (!value) return null;
	const v = value.trim();
	if (/^christ/i.test(v)) return 'Christian';
	if (/^muslim/i.test(v)) return 'Muslim';
	return v;
}

/**
 * Detect a clear single-family reference in a free-text purpose. Matches
 * "P-012" or "Family 31", and only when exactly one family is referenced AND
 * the text contains no other digit groups (so "Family 35,32, Lily" and
 * "11,36,37,38" stay unallocated).
 */
export function singleFamilyRef(purpose: string | null): string | null {
	if (!purpose) return null;
	const refs = new Set<string>();
	for (const m of purpose.matchAll(/P-(\d+)/gi)) {
		refs.add(`P-${m[1].padStart(3, '0')}`);
	}
	for (const m of purpose.matchAll(/family\s*(\d+)/gi)) {
		refs.add(`P-${m[1].padStart(3, '0')}`);
	}
	if (refs.size !== 1) return null;
	const digitGroups = purpose.match(/\d+/g);
	if (digitGroups === null || digitGroups.length !== 1) return null;
	let only = '';
	for (const ref of refs) only = ref;
	return only;
}

/**
 * The reference stores a single `name`; ours splits into a REQUIRED `firstName`
 * and an optional `lastName`. Everything before the last whitespace token is
 * the first name; a mononym sets `firstName` only. `firstName` is never empty.
 */
export function splitName(raw: string): { firstName: string; lastName?: string } {
	const parts = raw.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) {
		throw new Error('Cannot build a contact from an empty name');
	}
	if (parts.length === 1) {
		return { firstName: parts[0] };
	}
	return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

/**
 * The reference hard-codes `role: 'adult'` for every household member, even the
 * ones whose relationship is "child". Our vocabulary is richer, so the actual
 * relationship is mapped through.
 */
export function householdRoleFor(relationship: string | null): MemberRow['householdRole'] {
	const value = relationship === null ? '' : relationship.trim().toLowerCase();
	if (value === 'child') return 'child';
	if (value === 'head' || value === 'spouse') return 'parent_guardian';
	return 'adult';
}

/** Build a family's custom-field values. Keys whose source is null are omitted. */
export function buildAttributes(
	profile: ProfileRow | undefined,
	link?: string | null
): Record<string, AttributeValue> {
	const attrs: Record<string, AttributeValue> = {};
	if (profile && profile.years_enslaved !== null && profile.years_enslaved !== undefined) {
		attrs.years_enslaved = profile.years_enslaved;
	}
	if (profile && profile.reason !== null && profile.reason !== undefined) {
		attrs.reason_for_enslavement = profile.reason;
	}
	const religion = normalizeReligion(profile === undefined ? null : profile.religion);
	if (religion !== null) attrs.religion = religion;
	const routed = routeFamilyLink(link);
	if (routed !== null) attrs[routed.field] = routed.url;
	return attrs;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * Applies every transformation and returns the complete set of rows to write.
 * Pure: no IO, no randomness, no clock reads — the same input always produces
 * the same plan, which is what makes the wipe-and-reload converge.
 */
export function buildSeedPlan(input: SeedInput): SeedPlan {
	// -- Normalize the source ------------------------------------------------
	// "P-041-2" was a mis-typed sheet row. Applied to families.json here and to
	// family_sponsors.json independently below.
	const families: FamilyRow[] = input.families.map((f) =>
		f.number === 'P-041-2' ? { ...f, number: 'P-041' } : f
	);

	const profiles = input.profiles;
	const profileByNumber = new Map<string, ProfileRow>();
	for (const p of profiles) profileByNumber.set(p.number, p);

	// Families present ONLY in the profile doc (P-051…P-059) have no sheet row —
	// synthesize minimal rows so the standard pipeline creates them. They carry
	// no budget and no transactions (none exist yet).
	const sheetNumbers = new Set(families.map((f) => f.number));
	for (const p of profiles) {
		if (sheetNumbers.has(p.number)) continue;
		families.push({
			number: p.number,
			raw_name: p.family_name === null ? p.number : p.family_name,
			note: '',
			link: '',
			debt: null,
			fixed: {},
			grand_total: null,
			milestones: {},
			sponsor: { name: null, email: null, phone: null },
			row: 0,
			family_name: p.family_name === null ? p.number : p.family_name,
			name_extra: [],
			template_version: null
		});
	}

	const knownNumbers = new Set(families.map((f) => f.number));
	const fullyFunded = new Set(
		input.sponsors.fully_funded.map((n) => (n === 'P-041-2' ? 'P-041' : n))
	);

	// Freed at seed time: the fully-funded families, plus P-039, which the source
	// sheet records as freed without ever routing a sponsor through it.
	const seedFreed = (number: string): boolean => fullyFunded.has(number) || number === 'P-039';

	const stageFor = (family: FamilyRow): string => {
		if (FREED_BY_OTHER.has(family.number)) return 'freed_by_other';
		const funded = isYes(family.milestones.funded);
		if (funded || seedFreed(family.number)) return 'funded';
		const hasSponsor =
			Boolean(family.sponsor.name) ||
			// A sponsor name typed into the "funded" column (rather than yes/no)
			// also signals a published family with sponsor interest.
			(typeof family.milestones.funded === 'string' && !funded && !isNo(family.milestones.funded));
		if (hasSponsor) return 'published';
		if (family.debt !== null) return 'vetted';
		return 'identified';
	};

	// -- Projects ------------------------------------------------------------
	const stageCounts: Record<string, number> = {};
	const linkCounts = { managedMissions: 0, payment: 0, nonUrl: 0, unparsed: 0 };
	const paymentLinkHosts: Record<string, number> = {};
	const projects: ProjectRow[] = families.map((f) => {
		const stage = stageFor(f);
		stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
		const profile = profileByNumber.get(f.number);
		// Freed-by-other families carry the provenance note; everyone else
		// combines any sheet note with the profile doc's status annotation.
		const noteParts: string[] = [];
		if (f.note) noteParts.push(f.note);
		if (profile && profile.status) noteParts.push(profile.status);
		const story = FREED_BY_OTHER.has(f.number)
			? FREED_BY_OTHER_NOTE
			: noteParts.length > 0
				? noteParts.join(' · ')
				: undefined;
		// Tally how the `link` cell was read, purely for the driver's report. The
		// routing itself happens inside buildAttributes.
		const linkValue = f.link ? f.link.trim() : '';
		if (linkValue !== '') {
			const routed = routeFamilyLink(linkValue);
			if (routed === null) {
				// Either a name or scrap of text (which resolveFamilyName may consume
				// as the family name), or a url-looking string that will not parse.
				if (/^https?:\/\//i.test(linkValue)) linkCounts.unparsed++;
				else linkCounts.nonUrl++;
			} else if (routed.field === 'managed_missions_link') {
				linkCounts.managedMissions++;
			} else {
				linkCounts.payment++;
				paymentLinkHosts[routed.host] = (paymentLinkHosts[routed.host] ?? 0) + 1;
			}
		}
		const isPublished = PUBLIC_STAGES.has(stage);
		const isGoalMet = seedFreed(f.number);
		const row: ProjectRow = {
			number: f.number,
			name: resolveFamilyName(f),
			stage,
			attributes: buildAttributes(profile, f.link),
			isPublished,
			isGoalMet
		};
		// `photoUrl` is deliberately unset: the reference's "/families/<file>.png"
		// path would resolve to nothing here, because the images are not copied
		// into this repo. They are uploaded to Convex storage instead — see
		// `photos` below and the seedPhotos step in the driver.
		if (story !== undefined) row.story = story;
		if (isPublished) row.publishedAt = PLACEHOLDER_PUBLISHED_AT;
		if (isGoalMet) row.goalMetAt = PLACEHOLDER_GOAL_MET_AT;
		return row;
	});

	// -- Budgets (row-level snapshots) ---------------------------------------
	// P-040…P-046 and the profile-only families have no template/grand_total and
	// therefore no budget.
	const budgets: BudgetRow[] = [];
	for (const f of families) {
		if (f.template_version === null || f.grand_total === null) continue;
		const snapshot: Record<string, number> = {};
		for (const key of Object.keys(f.fixed)) {
			const value = f.fixed[key];
			if (value !== null) snapshot[`${key}_cents`] = toCents(value);
		}
		budgets.push({
			projectNumber: f.number,
			templateVersion: f.template_version,
			templateSnapshot: snapshot,
			debtCents: f.debt === null ? 0 : toCents(f.debt),
			// grand_total × 100 is authoritative — see BudgetRow.targetCents.
			targetCents: toCents(f.grand_total)
		});
	}

	// -- Documents (DONE milestone flags become stage-evidence documents) -----
	const documents: DocumentRow[] = [];
	for (const f of families) {
		for (const key of Object.keys(f.milestones)) {
			const mapping = DOCUMENT_MAP[key];
			if (!mapping || milestoneStatus(f.milestones[key]) !== 'done') continue;
			const doc: DocumentRow = {
				projectNumber: f.number,
				stage: mapping.stage,
				kind: mapping.kind
			};
			if (mapping.notes !== undefined) doc.notes = mapping.notes;
			documents.push(doc);
		}
	}
	// The "freed by other org" provenance, recorded as a document so the status
	// is auditable on the family rather than only implied by the stage.
	for (const f of families) {
		if (!FREED_BY_OTHER.has(f.number)) continue;
		documents.push({
			projectNumber: f.number,
			stage: 'freed_by_other',
			kind: 'other',
			notes: FREED_BY_OTHER_NOTE
		});
	}

	// -- Members + households ------------------------------------------------
	// A member is a contact (name only — members have no email) linked to the
	// project via projectMembers (role 'member'), with the relationship on the
	// link. Each family with members also gets a household.
	const households: HouseholdGroup[] = [];
	for (const p of profiles) {
		if (p.members.length === 0) continue;
		if (!knownNumbers.has(p.number)) continue;
		const members: MemberRow[] = p.members.map((m, index) => {
			const names = splitName(m.name);
			const member: MemberRow = {
				remoteId: `${SEED_CONTACT_REMOTE_ID_PREFIX}member:${p.number}:${index}`,
				firstName: names.firstName,
				householdRole: householdRoleFor(m.relationship)
			};
			if (names.lastName !== undefined) member.lastName = names.lastName;
			if (m.relationship !== null) member.relationship = m.relationship;
			return member;
		});
		// Primary contact = the first listed member; name derived from their surname.
		const primaryRaw = p.members[0].name.trim().split(/\s+/);
		const surname = primaryRaw[primaryRaw.length - 1] || p.number;
		households.push({
			projectNumber: p.number,
			householdName: `${surname} Household`,
			members
		});
	}

	// -- Photos --------------------------------------------------------------
	// The profile doc names one image per family. The bytes are never vendored:
	// the driver reads them from JUBILEE_PHOTOS_DIR and uploads them to Convex
	// storage, which is what `projects.photoStorageId` resolves through.
	const photos: PhotoRow[] = [];
	for (const p of profiles) {
		if (p.photo === null || p.photo.trim() === '') continue;
		if (!knownNumbers.has(p.number)) continue;
		photos.push({ projectNumber: p.number, file: p.photo.trim() });
	}

	// -- Sponsors ------------------------------------------------------------
	// The reference's `pledges` table has no equivalent here, so a sponsorship
	// becomes a projectMembers link with role 'sponsor' and the pledge status in
	// its attributes. One sponsor may back several families.
	const familyByNumber = new Map<string, FamilyRow>();
	for (const f of families) familyByNumber.set(f.number, f);

	const sponsorByKey = new Map<string, SponsorRow>();
	const sponsors: SponsorRow[] = [];
	for (const familyNumber of Object.keys(input.sponsors.family_sponsors)) {
		const sponsorName = input.sponsors.family_sponsors[familyNumber];
		const number = familyNumber === 'P-041-2' ? 'P-041' : familyNumber;
		if (!knownNumbers.has(number)) continue;
		const key = normalizeName(sponsorName);
		let sponsor = sponsorByKey.get(key);
		if (!sponsor) {
			const details = input.sponsors.sponsor_details[sponsorName] ?? {};
			const sheetRow = familyByNumber.get(number);
			const names = splitName(sponsorName);
			sponsor = {
				remoteId: `${SEED_CONTACT_REMOTE_ID_PREFIX}sponsor:${key}`,
				firstName: names.firstName,
				links: []
			};
			if (names.lastName !== undefined) sponsor.lastName = names.lastName;
			const email = details.email ?? (sheetRow ? (sheetRow.sponsor.email ?? undefined) : undefined);
			const phone = details.phone ?? (sheetRow ? (sheetRow.sponsor.phone ?? undefined) : undefined);
			if (email) sponsor.email = email;
			if (phone) sponsor.phone = phone;
			if (details.organization) sponsor.organization = details.organization;
			if (details.city) sponsor.city = details.city;
			if (details.state) sponsor.state = details.state;
			sponsorByKey.set(key, sponsor);
			sponsors.push(sponsor);
		}
		sponsor.links.push({
			projectNumber: number,
			status: fullyFunded.has(number) ? 'paid' : 'committed'
		});
	}

	// -- Transactions + allocations ------------------------------------------
	const transactions: TransactionRow[] = [];
	// DONATION cents allocated per project (raised = donations only), plus the
	// set of (transaction, project) pairs — the unique key Postgres enforced
	// declaratively — so the funded-family allocator never double-allocates.
	const donationAllocatedByProject = new Map<string, number>();
	const allocPairs = new Set<string>();
	// Donations with remaining unallocated capacity: the pool the funded-family
	// allocator draws from. No new money is ever created.
	const donationPool: { row: TransactionRow; remaining: number }[] = [];

	const allocate = (row: TransactionRow, slug: string, amountCents: number): void => {
		const isProject = knownNumbers.has(slug);
		if (!isProject && !PASSTHROUGH_SLUGS.has(slug)) {
			throw new Error(`Unknown fund slug: ${slug}`);
		}
		const allocation: AllocationRow = { amountCents };
		if (isProject) allocation.projectNumber = slug;
		row.allocations.push(allocation);
		allocPairs.add(`${row.note}:${slug}`);
	};

	const noteDonationAlloc = (slug: string, amountCents: number): void => {
		donationAllocatedByProject.set(slug, (donationAllocatedByProject.get(slug) ?? 0) + amountCents);
	};

	input.transactions.received.forEach((r, index) => {
		const amountCents = toCents(r.amount);
		const row: TransactionRow = {
			note: `${SEED_TRANSACTION_NOTE_PREFIX}received#${index} (sheet row ${r.row})`,
			type: 'donation',
			amountCents,
			allocations: []
		};
		if (r.date) row.occurredOn = r.date;
		if (r.purpose) row.reference = r.purpose;
		transactions.push(row);

		const ref = singleFamilyRef(r.purpose);
		let allocated = 0;
		if (ref !== null && knownNumbers.has(ref)) {
			allocate(row, ref, amountCents);
			noteDonationAlloc(ref, amountCents);
			allocated = amountCents;
		}
		donationPool.push({ row, remaining: amountCents - allocated });
	});

	input.transactions.sent.forEach((r, index) => {
		const amountCents = toCents(r.amount);
		const row: TransactionRow = {
			note: `${SEED_TRANSACTION_NOTE_PREFIX}sent#${index} (sheet row ${r.row})`,
			type: 'transfer',
			amountCents,
			allocations: []
		};
		if (r.date) row.occurredOn = r.date;
		if (r.method) row.method = r.method;
		if (r.purpose) row.reference = r.purpose;
		transactions.push(row);

		const ref = singleFamilyRef(r.purpose);
		if (ref !== null && knownNumbers.has(ref)) {
			allocate(row, ref, amountCents);
		}
	});

	input.transactions.pk_spend.forEach((r, index) => {
		const amountCents = toCents(r.amount);
		const row: TransactionRow = {
			note: `${SEED_TRANSACTION_NOTE_PREFIX}pk_spend#${index} (sheet row ${r.row})`,
			type: 'expenditure',
			amountCents,
			allocations: []
		};
		if (r.label) row.reference = r.label;
		transactions.push(row);

		// pk_spend rows carry an explicit fund: "P-xxx", "other-projects" or
		// "family-batch-unallocated". Family numbers are canonicalized (the sheet
		// is inconsistent about case) and share the P-041-2 fix-up.
		let slug = r.fund.trim();
		if (/^p-\d+(-\d+)?$/i.test(slug)) {
			slug = slug.toUpperCase();
			if (slug === 'P-041-2') slug = 'P-041';
		} else {
			slug = slug.toLowerCase();
		}
		allocate(row, slug, amountCents);
	});

	// -- Fund the fully-funded families from the donation pool ----------------
	// Each fully-funded family has its budget target allocated to it from
	// EXISTING unallocated donations, attributing the bulk gifts to the families
	// they made free. No new money is created, so received/sent/spent (and the
	// reconciliation) are unchanged.
	let fundedAllocations = 0;
	let fundedShortfallCents = 0;
	for (const f of families) {
		if (!fullyFunded.has(f.number)) continue;
		const target = f.grand_total === null ? 0 : toCents(f.grand_total);
		if (target <= 0) continue;
		let needed = target - (donationAllocatedByProject.get(f.number) ?? 0);
		for (const entry of donationPool) {
			if (needed <= 0) break;
			if (entry.remaining <= 0) continue;
			// unique(transactionId, projectId) — enforced here in code.
			if (allocPairs.has(`${entry.row.note}:${f.number}`)) continue;
			const take = Math.min(entry.remaining, needed);
			allocate(entry.row, f.number, take);
			noteDonationAlloc(f.number, take);
			entry.remaining -= take;
			needed -= take;
			fundedAllocations++;
		}
		if (needed > 0) fundedShortfallCents += needed; // pool exhausted (unexpected)
	}

	// Backfill: any donation STILL holding unallocated cents gets a
	// CAMPAIGN-LEVEL allocation, so nothing floats unattributed. projectId stays
	// unset, so per-project raised totals are unchanged.
	let catchAllAllocations = 0;
	for (const entry of donationPool) {
		if (entry.remaining <= 0) continue;
		allocate(entry.row, CATCH_ALL_SLUG, entry.remaining);
		entry.remaining = 0;
		catchAllAllocations++;
	}

	const usedVersions = new Set<string>();
	for (const f of families) {
		if (f.template_version !== null) usedVersions.add(f.template_version);
	}
	const costTemplates = Object.keys(COST_TEMPLATES)
		.filter((version) => usedVersions.has(version))
		.map((version) => ({ version, lineItems: COST_TEMPLATES[version] }));

	return {
		campaign: JUBILEE_CAMPAIGN,
		orgSettings: JUBILEE_ORG_SETTINGS,
		stages: SYSTEM_PIPELINE_STAGES,
		costTemplates,
		taskTemplate: {
			version: TASK_TEMPLATE_VERSION,
			effectiveFrom: TASK_TEMPLATE_EFFECTIVE_FROM,
			isActive: true,
			items: TASK_TEMPLATE_ITEMS
		},
		fieldCategory: JUBILEE_DETAILS_CATEGORY,
		fieldDefinitions: JUBILEE_FIELD_DEFINITIONS,
		projects,
		budgets,
		documents,
		households,
		sponsors,
		transactions,
		photos,
		notes: {
			stageCounts,
			fundedAllocations,
			catchAllAllocations,
			fundedShortfallCents,
			linkCounts,
			paymentLinkHosts
		}
	};
}
