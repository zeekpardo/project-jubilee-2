// ============================================================
// One person, two ids — and whether they may use the portal
// ============================================================
// A person in this app can exist twice: as an org member account, and as a
// `contacts` row. `contacts.authUserId` is the link, and this module is the
// only place the two are compared. That comparison drifting per call site is
// the failure that shows one person another person's work, so it is written
// down once and imported rather than re-derived.
//
// It lived under `model/taskViews.ts` while tasks were the only surface that
// needed it. The portal needs the same link for a different reason, and a
// module named for one feature is a poor home for the other's foundation.
//
// ONE RESOLVER, AND IT CAN ONLY BE SCOPED BY A URL. `resolveSiteViewer` is the
// single way to find out who is looking, on the public site and in the person's
// own `/{orgSlug}/me` alike. There was a second one, `resolvePortalViewer`, that
// took no argument and read the org out of Better Auth's active organization.
// It is gone: once the URL names the org, a session-derived org is a cross-tenant
// leak. A person signed in at org A opening org B's page would have been served
// their org A giving, profile and records under org B's URL, every field real
// and all of them for the wrong org. Deleting it is what makes that unwritable
// rather than merely discouraged.
//
// NEVER FROM AN ARGUMENT — the PERSON, that is. `resolveSiteViewer` takes one
// argument and the distinction is worth being exact about: an org SLUG says
// which org's page is being looked at, the same thing an anonymous visitor's URL
// says. It never says who the viewer is. The person comes from the session
// alone, so no argument to anything here can name one, and passing a different
// slug widens nothing — it only moves you to an org where you are, in all
// likelihood, nobody. A function that accepts a `contactId` may only do so to
// assert it equals the one this returned, at which point the argument is
// redundant, which is the point.
// ============================================================

import { ConvexError } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { TaskViewer } from '../../lib/features/tasks/types';
import { decideSiteViewer } from '../../lib/domain/site-viewer';
import { authComponent } from '../auth';
import { assertAuthUserAvailable, normalizeEmail } from './contacts';
import { orgIdForSlug } from './public';

/**
 * Both halves of one person: their org member account, and the contact record
 * linked to it via `contacts.authUserId`. Given either, this finds the other.
 *
 * Seeding from a CONTACT is resolved as well as seeding from a user, even
 * though only the user direction is strictly required. They are the same
 * person; a filter that matched one direction and not the other would be a
 * coin-flip about which id the assigner happened to pick.
 *
 * A contact id that names nothing, or a row in another org, resolves to just
 * the id it was given — never to a person. Widening on bad input is the one
 * failure mode that shows someone else's work.
 */
export async function resolvePersonIdentity(
	ctx: QueryCtx,
	orgId: string,
	seed: TaskViewer
): Promise<TaskViewer> {
	if (seed.userId && !seed.contactId) {
		const contact = await ctx.db
			.query('contacts')
			.withIndex('by_orgId_and_authUserId', (q) =>
				q.eq('orgId', orgId).eq('authUserId', seed.userId)
			)
			.first();
		return contact ? { userId: seed.userId, contactId: contact._id } : seed;
	}

	if (seed.contactId && !seed.userId) {
		// The id came off a URL, so it may not be an id at all. normalizeId is
		// how you ask that question without ctx.db.get throwing.
		const contactId = ctx.db.normalizeId('contacts', seed.contactId);
		if (!contactId) return seed;
		const contact = await ctx.db.get('contacts', contactId);
		if (!contact || contact.orgId !== orgId || !contact.authUserId) return seed;
		return { userId: contact.authUserId, contactId: seed.contactId };
	}

	return seed;
}

/**
 * The signed-in person as a URL-SCOPED SURFACE sees them: the public site, and
 * the person's own pages under `/{orgSlug}/me`. Scoped by URL, not by session.
 */
export type SiteViewer = {
	/** From `orgSettings.slug` — NEVER from the session's active organization. */
	orgId: string;
	/** From the session — NEVER from an argument. */
	userId: string;
	contact: Doc<'contacts'>;
};

/**
 * The name `model/portal.ts` knows this shape by.
 *
 * Its projection functions were written against the session-scoped viewer, and
 * their signatures need no edit because the shape never changed: one org, one
 * account, and the contact row that links them. What changed is where the org
 * comes from, and that is this module's business rather than the projection's —
 * a projection that only ever returns the viewer's own row cannot tell, and
 * should not have to.
 */
export type PortalViewer = SiteViewer;

/**
 * Who is looking at THIS ORG'S page.
 *
 * The org comes from the URL slug, and that is the one thing about this
 * function to hold on to. Composing (org from the URL) with (person from the
 * session) is what makes "a visitor from another org is simply anonymous" fall
 * out for free — there is no membership test to write and no cross-org special
 * case, because the contacts lookup below finds nothing and the page renders the
 * way it does for anybody else.
 *
 * `getAccess` IS NOT CALLED HERE, and that omission is the whole point. getAccess
 * resolves the ACTIVE ORGANIZATION out of Better Auth, so a person signed in at
 * org A and browsing org B's page would come back holding their org A identity
 * while standing on org B's URL. That is the cross-tenant leak, and it is
 * silent — every field returned would be real, just for the wrong org. So the
 * active org is never consulted: the session is asked for the person via
 * `safeGetAuthUser` and for nothing else.
 *
 * Returns null — never throws — for every way of not being this org's viewer:
 * an unknown slug, a signed-out visitor, no contact in THIS org, or access
 * withdrawn. One anonymous outcome with no partial states, because the caller
 * is a public page that has to keep rendering either way.
 *
 * THE READS ARE HERE, THE RULE IS NOT. What these three findings add up to is
 * `decideSiteViewer` in `lib/domain/site-viewer.ts` — including that
 * `portalAccess` must be 'active', and that a contact from another org is
 * refused even though the index should never return one. It lives there for the
 * reason `permissions.ts` lives beside `access.ts`: three index reads are
 * plumbing a type error catches, and the rule they feed is the part worth
 * testing exhaustively. Do not re-decide anything here; add the case there,
 * where it is covered.
 *
 * NO STAFF EXEMPTION, which is where this parts company with the session-scoped
 * resolver it replaced: that one admitted staff without an 'active' row via
 * `canAccessAdmin`. The exemption reads a role out of the SESSION's
 * organization while the contact here came from the URL's, and asking org A's
 * role about org B's page is the confusion resolving orgId from the slug exists
 * to prevent. It would buy nothing either: the LINK is the credential, and
 * everything this viewer unlocks is their own row. A staff member who wants to
 * see their own giving is claimed and linked like anyone else.
 */
export async function resolveSiteViewer(
	ctx: QueryCtx,
	orgSlug: string
): Promise<SiteViewer | null> {
	// The two early returns below are read avoidance, not decisions —
	// `decideSiteViewer` refuses both cases anyway. There is no point asking the
	// session who someone is on behalf of an org that does not exist.
	const orgId = await orgIdForSlug(ctx, orgSlug);
	if (!orgId) return null;

	const user = await authComponent.safeGetAuthUser(ctx);
	if (!user) return null;

	// `.unique()` rather than `.first()`: two contacts holding one account in one
	// org breaks `unique(orgId, authUserId)`, and quietly picking whichever came
	// back first would pick one of a person's two identities by coin flip. A
	// broken invariant is worth the throw, because the alternative is a page that
	// shows the wrong half of someone and says nothing about it.
	const contact = await ctx.db
		.query('contacts')
		.withIndex('by_orgId_and_authUserId', (q) => q.eq('orgId', orgId).eq('authUserId', user._id))
		.unique();

	return decideSiteViewer({ orgId, userId: user._id, contact });
}

// ------------------------------------------------------------------
// The invitation lifecycle
// ------------------------------------------------------------------
// Three writes, all here rather than in the routes that trigger them. The
// reference app stamped `invitedAt` on one of its two invite paths and not the
// other, so a contact invited by the second showed no "Invited" badge and
// nobody could tell whether the email had gone. A second invite path is a
// certainty; a second copy of the stamp is not.

/**
 * Offer this person a portal login. Idempotent: re-inviting someone re-stamps
 * the date, which is what "resend" means, and re-inviting someone who already
 * signed in leaves them active rather than knocking them back a step.
 */
export async function offerPortalAccess(ctx: MutationCtx, contact: Doc<'contacts'>): Promise<void> {
	await ctx.db.patch('contacts', contact._id, {
		portalAccess: contact.portalAccess === 'active' ? 'active' : 'invited',
		invitedAt: Date.now()
	});
}

/**
 * Withdraw it. The row, the giving and the history all stay — this is a state,
 * not a deletion — and the link to the account is cut so a signed-in session
 * resolves to no viewer on its very next read.
 *
 * Their org MEMBERSHIP is deliberately left alone. It is Better Auth's row,
 * not ours, and removing it is a separate decision an admin makes from the
 * members screen; what it would buy is nothing, because `portal_member` holds
 * no capability, so a revoked person with a live membership can reach exactly
 * one thing — the portal's own "nothing here for you" page.
 */
export async function revokePortalAccess(
	ctx: MutationCtx,
	contact: Doc<'contacts'>
): Promise<void> {
	await ctx.db.patch('contacts', contact._id, {
		portalAccess: 'revoked',
		authUserId: undefined
	});
}

/**
 * First sign-in: bind the account to the contact it was invited as.
 *
 * Claims an UNLINKED contact only. Without that condition one account could
 * take over another person's already-linked contact by signing in with an
 * address that had since been reassigned — and the contact carries their
 * giving, their household and their medical notes.
 * `assertAuthUserAvailable` enforces the same rule from the other side: one
 * account may not hold two contacts in an org.
 *
 * Returns null when there is nothing to claim, which is the ordinary case —
 * every portal load after the first, and every staff member who signs in
 * having never been invited to anything.
 */
export async function claimPortalContact(
	ctx: MutationCtx,
	orgId: string,
	userId: string,
	email: string | undefined
): Promise<Id<'contacts'> | null> {
	const emailLower = normalizeEmail(email);
	if (!emailLower) return null;

	// Already claimed by this account on an earlier load. Cheaper than the email
	// lookup and, more importantly, means a second call is never a second claim.
	const linked = await ctx.db
		.query('contacts')
		.withIndex('by_orgId_and_authUserId', (q) => q.eq('orgId', orgId).eq('authUserId', userId))
		.unique();
	if (linked) return linked._id;

	const contact = await ctx.db
		.query('contacts')
		.withIndex('by_orgId_and_emailLower', (q) => q.eq('orgId', orgId).eq('emailLower', emailLower))
		.unique();
	if (!contact) return null;
	if (contact.authUserId !== undefined) return null;
	if (contact.portalAccess !== 'invited') return null;

	await assertAuthUserAvailable(ctx, orgId, userId, contact._id);

	await ctx.db.patch('contacts', contact._id, {
		authUserId: userId,
		portalAccess: 'active'
	});
	return contact._id;
}

/** The contact an invite is being sent to, or a reason it cannot be. */
export async function requireInvitableContact(
	ctx: MutationCtx,
	orgId: string,
	contactId: Id<'contacts'>
): Promise<Doc<'contacts'>> {
	const contact = await ctx.db.get('contacts', contactId);
	if (!contact || contact.orgId !== orgId) {
		throw new ConvexError('Contact not found');
	}
	// The magic link goes to an address, so there has to be one. Said here
	// rather than left to the mail send, which fails somewhere the admin is no
	// longer looking.
	if (!contact.emailLower) {
		throw new ConvexError('Add an email address before inviting this person to the portal');
	}
	return contact;
}
