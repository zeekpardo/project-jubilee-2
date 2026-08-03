// ============================================================
// THE SIGNED-IN SITE PROJECTION
// ============================================================
// What a signed-in visitor is allowed to see ON A PUBLIC PAGE, decided here so
// `convex/site/queries.ts` can join and bound without deciding anything.
//
// This is the THIRD tier, and the narrowest of the three. `model/public.ts` is
// the anonymous wall. `model/portal.ts` is the viewer's own private surface,
// reached only from pages that are never cached and never anonymous. This
// module serves pages that an anonymous stranger may be looking at one request
// later, so it is deliberately not the portal with a slug attached.
//
// ONE RULE: THE PUBLIC PAGE GAINS RECOGNITION, NOT DATA. A signed-in visitor
// sees exactly the public content an anonymous one sees — every record still
// comes from the wall, untouched — plus two things about THEMSELVES: their own
// name, so a header can greet them, and a total of their own giving to the
// record already on screen. Nothing here widens the wall, and nothing here may
// grow to. The moment this module returns a record field the wall withholds,
// the site has two contradictory answers for the same page.
//
//   EXPOSED, and nothing else:
//   - the viewer's own first name and display name, through `toSiteGreeting`
//   - a SUM of the viewer's own giving to one record, through
//     `givingForRecord` — three numbers, no gift rows, no allocation rows
//
//   NEVER EXPOSED. Do not add without a privacy review:
//   - anything about any other person. Not another supporter of this record,
//     not a supporter count, not "you and 12 others"
//   - the viewer's contact id, or any other Convex document id. See
//     `toSiteGreeting` for why an id on this surface is worse than useless
//   - the viewer's own address, phone, email or preferences. Those are the
//     portal's, and the portal is served from routes that are never cached
//   - unpublished records or protected custom fields, on any path
//
// WHY NOT `portalGiving`. It returns up to 500 gifts with every allocation of
// each, which is the right shape for a giving history and the wrong shape for
// one sentence on a project page: shipping a donor's entire ledger to a browser
// so the browser can add up the part that matches is both a page of wasted
// bytes and a far larger disclosure than the sentence needs. The read below is
// the focused sibling — it does the summing on the server and returns the
// answer.
// ============================================================

import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { SiteViewer } from './identity';

/**
 * How many of the viewer's own transactions one in-context read scans.
 *
 * The same ceiling as `PORTAL_GIFT_MAX`, for the same reason: one person's
 * giving to one organization is a small set by nature, and this is the bound
 * that keeps the read from growing with it rather than a page size anyone is
 * expected to reach.
 *
 * The failure it admits is quiet, so it is written down here. `SiteGivingForRecord`
 * carries no `truncated` flag — the sentence it feeds has nowhere to put one —
 * so a donor past this many gifts would see a total that understates what they
 * gave. That is why the ceiling is generous rather than tight. The number to
 * watch is transactions per contact; if a recurring giver can plausibly cross
 * it, this needs a per-record index rather than a bigger number.
 */
export const SITE_GIFT_SCAN_MAX = 500;

// ------------------------------------------------------------------
// The greeting
// ------------------------------------------------------------------

/**
 * The least that lets a header greet someone.
 *
 * Two strings, both of them this person's own name, and deliberately nothing
 * else — no email, no id, no contact details. This shape is read by a page that
 * is anonymous-capable and publicly cacheable, so the question it answers is
 * not "what may this person see" but "what is safe to have in a browser that a
 * stranger may be sitting at one navigation later".
 */
export type SiteGreeting = {
	/** For the greeting itself: "Hi, Amina". */
	firstName: string;
	/** For the account menu, where a fuller name says WHICH account is signed in. */
	displayName: string;
	/**
	 * Whether to offer this person a way back into the admin app FOR THIS ORG.
	 *
	 * A capability the viewer holds over themselves, not a fact about anyone
	 * else, which is why it may cross this boundary at all. It says only "you
	 * have a dashboard here" — no role, no capability list, nothing another
	 * person could be inferred from.
	 *
	 * The org match is the whole of it; see `getSiteViewer` for why.
	 */
	canAdminister: boolean;
};

/**
 * The viewer's own name, and only their name.
 *
 * NO CONTACT ID. It would be the natural third field and it is the one that
 * must not be here. A contact id in the browser is an argument waiting to be
 * accepted: the next donation mutation that takes a `contactId` "because the
 * client already has it" is exactly the client-supplied identity that both this
 * module and `model/portal.ts` exist to forbid, and it would be reachable by
 * anyone who can read a network tab and change a string. Identity on this
 * surface comes from the session on every single read, so there is no id the
 * client needs to hold.
 *
 * The one use the plan names — keying the donation form so a change of identity
 * remounts rather than merging typed state — is served by the name. That is
 * weaker in theory, since two contacts can share a display name, and identical
 * in practice for one browser signing in as one person. What it costs when it
 * does fail is a form that keeps a half-typed value; what an exposed id costs
 * when it fails is attribution the caller chose.
 *
 * `publicFirstName` is not used here. That field is the admin's opt-in for
 * publishing a name ABOUT someone on a record; this is the person reading their
 * own greeting, and they are entitled to the name they actually go by.
 */
export function toSiteGreeting(contact: Doc<'contacts'>, canAdminister: boolean): SiteGreeting {
	const last = contact.lastName?.trim();
	return {
		firstName: contact.firstName,
		displayName: last ? `${contact.firstName} ${last}` : contact.firstName,
		canAdminister
	};
}

// ------------------------------------------------------------------
// Their own giving, in the context of one record
// ------------------------------------------------------------------

/**
 * "You've given $250 to this family — last gift Mar 4", and nothing more.
 *
 * Three scalars. No gift ids, no allocation rows, no method or reference: a
 * donor wanting their receipts has a giving history page for that, and this
 * sentence does not need to carry one.
 */
export type SiteGivingForRecord = {
	totalCents: number;
	giftCount: number;
	/** Null when every matching gift was recorded without a date. */
	lastGiftOn: string | null;
};

/**
 * Which record the viewer is looking at. A project when they are on a record
 * page, the campaign alone when they are on a campaign page.
 */
export type SiteGivingScope = {
	campaignId: Id<'campaigns'>;
	projectId?: Id<'projects'> | null;
};

/**
 * What this person has given to THIS record.
 *
 * SCOPED BY THE DONOR, NEVER BY THE RECORD. The read starts at
 * `transactions.by_contactId` — the column that records the attribution — and
 * narrows to the record from there. The obvious alternative, starting at
 * `allocations.by_projectId` and keeping the rows that turn out to be the
 * viewer's, would read every supporter's giving to that record in order to find
 * one person's, which is both unbounded in the number of donors a popular
 * record has and precisely the read the privacy wall exists to prevent. A
 * question about the viewer is answered from the viewer's own rows.
 *
 * ALLOCATION AMOUNTS, NOT GIFT AMOUNTS. One gift can be split across several
 * records, so crediting the whole transaction to whichever record the visitor
 * happens to be standing on would tell a donor who split $300 three ways that
 * they gave $300 to each. Only the matching parts are summed.
 *
 * WITH a project, the match is `allocation.projectId`. WITHOUT one, it is
 * `allocation.campaignId`, which is the campaign-level total and deliberately
 * includes project-less overhead allocations: at campaign scope that money is
 * genuinely part of what this person gave to this campaign.
 *
 * Only `donation` rows, and only rows belonging to the viewer's org. Transfers
 * and expenditures are the organization's own movements, and a contact id is
 * unique to one org's ledger but the index is not scoped to an org, so the org
 * check is what keeps a shared row out of the wrong site.
 *
 * NULL RATHER THAN ZERO when nothing matches, so the caller renders nothing at
 * all. A note that says "You've given $0 to this family" is worse than no note:
 * it turns a page for supporters into a reminder that the reader is not one.
 */
export async function givingForRecord(
	ctx: QueryCtx,
	viewer: SiteViewer,
	scope: SiteGivingScope
): Promise<SiteGivingForRecord | null> {
	const transactions = await ctx.db
		.query('transactions')
		.withIndex('by_contactId', (q) => q.eq('contactId', viewer.contact._id))
		.take(SITE_GIFT_SCAN_MAX);

	let totalCents = 0;
	let giftCount = 0;
	let lastGiftOn: string | null = null;

	for (const transaction of transactions) {
		if (transaction.orgId !== viewer.orgId || transaction.type !== 'donation') continue;

		const matchedCents = await matchedAllocationCents(ctx, transaction._id, scope);
		// A gift whose matching share is zero or less did not reach this record:
		// either it was allocated elsewhere entirely, or the allocation is a
		// bookkeeping artifact. Counting it would put a gift in the count with no
		// money behind it, which is the "$0" sentence in another form.
		if (matchedCents <= 0) continue;

		totalCents += matchedCents;
		giftCount += 1;

		// Dates are ISO day strings, so the plain comparison is chronological. A
		// gift recorded without a date cannot be the latest one — it can only be
		// undated — so it contributes to the total and not to this.
		const occurredOn = transaction.occurredOn;
		if (occurredOn && (lastGiftOn === null || occurredOn > lastGiftOn)) {
			lastGiftOn = occurredOn;
		}
	}

	if (giftCount === 0) return null;
	return { totalCents, giftCount, lastGiftOn };
}

/**
 * How much of one gift reached the record in scope.
 *
 * At project scope the index carries both halves of the question, so the read
 * returns only the rows that already match. At campaign scope there is no
 * `by_transactionId_and_campaignId` index, so the campaign is compared in
 * memory over the rows of a SINGLE gift — a handful of splits, bounded by the
 * transaction rather than by the table, which is why this is a post-filter and
 * not a scan.
 */
async function matchedAllocationCents(
	ctx: QueryCtx,
	transactionId: Id<'transactions'>,
	scope: SiteGivingScope
): Promise<number> {
	if (scope.projectId) {
		const projectId = scope.projectId;
		const rows = await ctx.db
			.query('allocations')
			.withIndex('by_transactionId_and_projectId', (q) =>
				q.eq('transactionId', transactionId).eq('projectId', projectId)
			)
			.collect();
		return rows.reduce((total, row) => total + row.amountCents, 0);
	}

	const rows = await ctx.db
		.query('allocations')
		.withIndex('by_transactionId', (q) => q.eq('transactionId', transactionId))
		.collect();

	let total = 0;
	for (const row of rows) {
		if (row.campaignId === scope.campaignId) total += row.amountCents;
	}
	return total;
}
