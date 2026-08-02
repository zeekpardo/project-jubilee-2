// ============================================================
// THE PORTAL PROJECTION
// ============================================================
// This module and `convex/portal/queries.ts` are the ONLY data source the
// `(portal)` pages may read from. It is a SIBLING of the privacy wall in
// `model/public.ts`, built with the same discipline, and deliberately not the
// wall with a viewer passed through it.
//
// Why a sibling rather than a parameter. The wall is anonymous BY
// CONSTRUCTION: every function there takes `(ctx, doc)` and never touches
// identity, and its callers create their Convex client with no token at all.
// Threading a viewer through would make "no database document is ever spread"
// a conditional guarantee, which is the exact property that module exists to
// make unconditional. Worse, the things a portal is FOR — donation amounts,
// donor-to-record links, a person's own contact details — are on the wall's
// never-exposed list. A portal read is not a loosening of a dial; it is the
// inverse of a stated rule, and it needs its own rule.
//
// THREE RULES, and everything here follows from them:
//
//   1. NEVER A CLIENT-SUPPLIED IDENTITY. Every function takes a
//      `PortalViewer` resolved from the session by `model/identity.ts`. No
//      function here accepts a contactId, and none should grow one.
//
//   2. CONNECTION FILTERS PUBLIC DATA; IT DOES NOT WIDEN IT. A supporter sees
//      a record exactly as an anonymous visitor would — the card comes from
//      `toPublicProject`, unchanged — plus the giving that is genuinely
//      theirs. The relationship decides WHICH cards appear, never what is on
//      one. This is why there is no third tier of record data.
//
//   3. PERSONAL DATA IS ONLY EVER THE VIEWER'S OWN. Their giving, their
//      profile, their tasks. No function here returns another person's row,
//      and none takes an argument that could name one.
//
//   EXPOSED, and nothing else:
//   - the viewer's own contact row, through `toPortalProfile` — an allowlist,
//     built field by field, which is why `medicalNotes`, `notes`, `barcodes`,
//     `remoteId` and the background-check flag are absent from it
//   - the viewer's own donations: amount, date, method, reference, and the
//     per-record split of each one. `transactions.contactId` is the
//     attribution, so "theirs" is a column and not an inference
//   - public cards for the records they are connected to, from the wall
//   - ONE second projection: `toPortalOwnRecord`, the unscrubbed name and
//     story of a record the viewer is themselves a member of. That is the
//     single case where the public view is wrong rather than merely partial —
//     a family reading their own page should not be shown the scrubbed
//     version of their own name.
//
//   NEVER EXPOSED. Do not add without a privacy review:
//   - any other person's contact row, giving, or connection. Not another
//     member of their own record, not another supporter of it
//   - protected custom-field keys, EVEN on the viewer's own record. The wall
//     withholds site references, addresses and locations because this app
//     serves people escaping forced labour, and a portal session lives on a
//     phone that can be taken. Being the subject of a record is not a reason
//     to print where its people are held
//   - anything about who else supports a record, including how many
//   - internal ledger structure: budgets, expenditures, reconciliation
//
// THE COUNT THRESHOLD DOES NOT APPLY HERE. `orgSettings.publicCountThreshold`
// suppresses small aggregates so an anonymous visitor cannot identify one
// household from a count of one. A person looking at their own record already
// knows who is in it. Nothing in this module computes an aggregate over
// anyone but the viewer, which is why no threshold appears below — reusing
// the wall's stat path would have inherited a rule that does not fit the tier.
// ============================================================

import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { isPersonReachedRole } from '../../lib/domain/campaign-stats';
import { toPublicProject, type PublicProject } from './public';
import type { PortalViewer } from './identity';

/**
 * How many gifts one portal read returns. A donor's own history is a small
 * set by nature; this is the ceiling that keeps the read bounded rather than a
 * page size anyone is expected to hit.
 */
export const PORTAL_GIFT_MAX = 500;

/**
 * How many records one portal read returns. Connections come from giving and
 * from membership, both of which are small per person.
 */
export const PORTAL_RECORD_MAX = 200;

// ------------------------------------------------------------------
// The viewer's own profile
// ------------------------------------------------------------------

export type PortalProfile = {
	firstName: string;
	lastName: string | null;
	email: string | null;
	phone: string | null;
	addressLine1: string | null;
	addressLine2: string | null;
	city: string | null;
	state: string | null;
	postalCode: string | null;
	country: string | null;
	updateDetail: 'summary' | 'full' | null;
	preferredContact: 'email' | 'mail' | 'phone' | null;
};

/**
 * The viewer's own details, copied field by field.
 *
 * Everything here is something this person told us about themselves, which is
 * the test for whether a column belongs. `notes`, `medicalNotes`,
 * `membership`, `status`, `passedBackgroundCheck` and `source` are things the
 * ORGANIZATION recorded about them, and a portal is not the place to find out
 * how you have been filed.
 */
export function toPortalProfile(contact: Doc<'contacts'>): PortalProfile {
	return {
		firstName: contact.firstName,
		lastName: contact.lastName ?? null,
		email: contact.email ?? null,
		phone: contact.phone ?? null,
		addressLine1: contact.addressLine1 ?? null,
		addressLine2: contact.addressLine2 ?? null,
		city: contact.city ?? null,
		state: contact.state ?? null,
		postalCode: contact.postalCode ?? null,
		country: contact.country ?? null,
		updateDetail: contact.updateDetail ?? null,
		preferredContact: contact.preferredContact ?? null
	};
}

/**
 * The fields a portal member may edit about themselves. A whitelist, checked
 * in the mutation, and deliberately shorter than what they can SEE: a donor
 * correcting their own address is ordinary, a donor rewriting their own name
 * is a dedup problem for whoever has to match them next.
 */
export const PORTAL_EDITABLE_PROFILE_FIELDS = [
	'phone',
	'addressLine1',
	'addressLine2',
	'city',
	'state',
	'postalCode',
	'country',
	'updateDetail',
	'preferredContact'
] as const;

// ------------------------------------------------------------------
// The viewer's own giving
// ------------------------------------------------------------------

/** One record's share of one gift. */
export type PortalGiftAllocation = {
	/** The public identifier. Portal reads address records the way the wall does. */
	number: string | null;
	name: string | null;
	amountCents: number;
};

export type PortalGift = {
	id: string;
	occurredOn: string | null;
	amountCents: number;
	method: string | null;
	reference: string | null;
	receiptUrl: string | null;
	allocations: PortalGiftAllocation[];
};

export type PortalGiving = {
	gifts: PortalGift[];
	lifetimeCents: number;
	giftCount: number;
	firstGiftOn: string | null;
	lastGiftOn: string | null;
	/** True when the history was cut at PORTAL_GIFT_MAX, so a short list says so. */
	truncated: boolean;
};

/**
 * Everything this person has given, and where it went.
 *
 * Scoped by `transactions.by_contactId`, so "theirs" is an index lookup on a
 * column that records the attribution — never a filter over the org's ledger
 * that happens to keep the right rows. A donation with no `contactId` belongs
 * to nobody and is therefore in nobody's portal.
 *
 * Only `donation` rows. Transfers and expenditures are the organization's own
 * movements; a donor seeing them would be seeing the org's books.
 */
export async function portalGiving(ctx: QueryCtx, viewer: PortalViewer): Promise<PortalGiving> {
	const rows = await ctx.db
		.query('transactions')
		.withIndex('by_contactId', (q) => q.eq('contactId', viewer.contact._id))
		.take(PORTAL_GIFT_MAX + 1);

	const truncated = rows.length > PORTAL_GIFT_MAX;
	const donations = rows
		.slice(0, PORTAL_GIFT_MAX)
		.filter((row) => row.orgId === viewer.orgId && row.type === 'donation');

	const gifts: PortalGift[] = [];
	for (const donation of donations) {
		const allocations = await ctx.db
			.query('allocations')
			.withIndex('by_transactionId', (q) => q.eq('transactionId', donation._id))
			.collect();

		const split: PortalGiftAllocation[] = [];
		for (const allocation of allocations) {
			// A project-less allocation is campaign-level overhead. It is still
			// their money, so it is listed — with no record attached, which is what
			// it is, rather than dropped as if the gift were smaller.
			const project = allocation.projectId
				? await ctx.db.get('projects', allocation.projectId)
				: null;
			split.push({
				number: project?.number ?? null,
				// The PUBLIC name, even here. A supporter sees a record the way an
				// anonymous visitor does; being the one who paid for it does not
				// change what the record's people agreed to publish.
				name: project?.publicName?.trim() || null,
				amountCents: allocation.amountCents
			});
		}

		gifts.push({
			id: donation._id,
			occurredOn: donation.occurredOn ?? null,
			amountCents: donation.amountCents,
			method: donation.method ?? null,
			reference: donation.reference ?? null,
			receiptUrl: donation.receiptUrl ?? null,
			allocations: split
		});
	}

	// Newest first, and undated gifts last: an absent date sorts before every
	// real one as a string, which would put the least informative rows on top.
	gifts.sort((a, b) => (b.occurredOn ?? '').localeCompare(a.occurredOn ?? ''));

	const dated = gifts.map((gift) => gift.occurredOn).filter((on): on is string => on !== null);

	return {
		gifts,
		lifetimeCents: gifts.reduce((total, gift) => total + gift.amountCents, 0),
		giftCount: gifts.length,
		firstGiftOn: dated.length > 0 ? dated[dated.length - 1] : null,
		lastGiftOn: dated.length > 0 ? dated[0] : null,
		truncated
	};
}

// ------------------------------------------------------------------
// The records they are connected to
// ------------------------------------------------------------------

/**
 * How this person is connected to a record. Both can be true at once — a
 * volunteer who also gives — so this is a pair of flags rather than a single
 * kind.
 */
export type PortalConnection = {
	/** They have given money that reached this record. */
	supports: boolean;
	/** They are on the record: a member of the family, an attendee, a volunteer. */
	belongsTo: boolean;
};

export type PortalRecord = {
	connection: PortalConnection;
	card: PublicProject;
};

/**
 * Which records this person is connected to, and how.
 *
 * The union of two lookups: projects their donations were allocated to, and
 * projects they hold a `projectMembers` row on. Returned as ids so the caller
 * can decide what to build from them — a public card, an own-record view — and
 * so the two lookups are written once.
 */
export async function portalConnections(
	ctx: QueryCtx,
	viewer: PortalViewer
): Promise<Map<Id<'projects'>, PortalConnection>> {
	const connections = new Map<Id<'projects'>, PortalConnection>();

	const mark = (projectId: Id<'projects'>, key: keyof PortalConnection) => {
		const existing = connections.get(projectId) ?? { supports: false, belongsTo: false };
		existing[key] = true;
		connections.set(projectId, existing);
	};

	const donations = await ctx.db
		.query('transactions')
		.withIndex('by_contactId', (q) => q.eq('contactId', viewer.contact._id))
		.take(PORTAL_GIFT_MAX);
	for (const donation of donations) {
		if (donation.orgId !== viewer.orgId || donation.type !== 'donation') continue;
		const allocations = await ctx.db
			.query('allocations')
			.withIndex('by_transactionId', (q) => q.eq('transactionId', donation._id))
			.collect();
		for (const allocation of allocations) {
			if (allocation.projectId) mark(allocation.projectId, 'supports');
		}
	}

	const memberships = await ctx.db
		.query('projectMembers')
		.withIndex('by_contactId', (q) => q.eq('contactId', viewer.contact._id))
		.take(PORTAL_RECORD_MAX);
	for (const membership of memberships) {
		if (membership.orgId !== viewer.orgId) continue;
		mark(membership.projectId, 'belongsTo');
	}

	return connections;
}

/**
 * The public card for a connected record — the wall's own projection, called
 * rather than reimplemented.
 *
 * That is not only economy. `toPublicProject` loads the org's public policy
 * ITSELF, "so no caller can forget it", and a portal projection that built its
 * own card would bypass that org's added denylist in silence. Calling the wall
 * means the portal cannot drift from what the public site shows, which is rule
 * 2 enforced by construction rather than by discipline.
 *
 * Returns null for an UNPUBLISHED record. A supporter's card list is the
 * public list filtered by their connection, and an unpublished record is not
 * on the public list — so giving to one does not conjure a page that its
 * people have not agreed to show.
 */
export async function toPortalRecord(
	ctx: QueryCtx,
	project: Doc<'projects'>,
	campaign: Doc<'campaigns'>,
	connection: PortalConnection
): Promise<PortalRecord | null> {
	if (!project.isPublished) return null;
	return { connection, card: await toPublicProject(ctx, project, campaign) };
}

// ------------------------------------------------------------------
// Their own record — the one second projection
// ------------------------------------------------------------------

export type PortalOwnRecord = {
	card: PublicProject;
	/** The real name, not the scrubbed one. See below. */
	name: string;
	story: string | null;
};

/**
 * A record the viewer is themselves part of, shown to them unscrubbed.
 *
 * This is the single place the public view is WRONG rather than merely
 * partial. `publicName` exists because publishing a family's real name can
 * endanger them; showing that same family their own page under a name they did
 * not choose is not privacy, it is a bug. So the real `name` and the full
 * `story` are added on top of the public card.
 *
 * Two things it deliberately does NOT add. Protected custom-field keys stay
 * withheld — site references and locations are dangerous to print on a device
 * that can be taken, and being the subject of a record is not a reason to
 * print where its people are held. And nothing about the record's supporters
 * appears, not even a count: who gives to a family is the giver's business.
 *
 * Only for a role the record SERVES. A sponsor holds a `projectMembers` row
 * too, and a donor is not the subject of the record they fund — the same
 * distinction `toPublicProject` makes when it counts household size.
 */
export async function toPortalOwnRecord(
	ctx: QueryCtx,
	viewer: PortalViewer,
	project: Doc<'projects'>,
	campaign: Doc<'campaigns'>
): Promise<PortalOwnRecord | null> {
	const link = await ctx.db
		.query('projectMembers')
		.withIndex('by_projectId_and_contactId', (q) =>
			q.eq('projectId', project._id).eq('contactId', viewer.contact._id)
		)
		.unique();
	if (!link || link.orgId !== viewer.orgId) return null;
	if (!isPersonReachedRole(link.role)) return null;

	return {
		card: await toPublicProject(ctx, project, campaign),
		name: project.name,
		story: project.story ?? null
	};
}
