// ============================================================
// May this person be recognized on this org's public site
// ============================================================
// The decision half of `convex/model/identity.ts`'s `resolveSiteViewer`, pulled
// out here for the same reason `permissions.ts` sits beside `access.ts`: the
// three database reads are plumbing a type error would catch, and the rule they
// feed is the part worth writing down once and testing exhaustively.
//
// Pure, like every other module here. It is handed what the reads found and
// answers whether that adds up to a viewer. It never reads anything itself, so
// there is no ordering, no session, and no way for it to widen an answer by
// asking a second question.
//
// The whole rule: an org named by the URL, a person named by the session, and a
// contact that belongs to BOTH. Any of the three missing is the same answer as
// all three missing — a stranger. That single outcome is deliberate. A public
// page renders identically for someone signed out, someone signed in at another
// org, and someone whose access was withdrawn, and it is not this function's
// business to let a caller tell those apart.
// ============================================================

/**
 * The fields of a `contacts` row this decision turns on.
 *
 * Structural rather than a `Doc<'contacts'>` so `lib/domain` stays free of
 * Convex's generated types, matching every other module here. The caller's real
 * document satisfies it, and comes back out unchanged.
 */
export interface SiteViewerContact {
	_id: string;
	orgId: string;
	portalAccess?: 'invited' | 'active' | 'revoked';
}

/** What the three lookups found. Any of them may have found nothing. */
export interface SiteViewerInputs<C extends SiteViewerContact> {
	/** Resolved from `orgSettings.slug`. Null when the slug names no org. */
	orgId: string | null;
	/** Resolved from the Better Auth session. Null when signed out. */
	userId: string | null;
	/** Found by (orgId, authUserId). Null when this account is nobody here. */
	contact: C | null;
}

/** A recognized viewer: the org, the person, and the row that links them. */
export interface SiteViewerDecision<C extends SiteViewerContact> {
	orgId: string;
	userId: string;
	contact: C;
}

/**
 * Whether these three findings amount to a viewer.
 *
 * Generic on the contact so the caller gets its own document back rather than a
 * copy, and never has to re-read the row it just fetched.
 *
 * REQUIRES `portalAccess === 'active'`, which is stricter than refusing only
 * 'revoked'. Every path that links an account to a contact sets both at once —
 * `claimPortalContact` writes `authUserId` and 'active' together, and
 * `revokePortalAccess` writes 'revoked' and clears `authUserId` together — so a
 * row that is linked but not active is a row two writes disagree about. Reading
 * it as a viewer would mean the one place that can see the disagreement chose
 * to resolve it in the permissive direction. `undefined` is refused for the
 * same reason and stated as its own case in the tests, because a field that was
 * never written and a field explicitly set to 'invited' are different states in
 * the schema even though they are the same answer here.
 *
 * This is where the surface parts company with `resolvePortalViewer`, which
 * admits staff without an 'active' row through `canAccessAdmin`. That exemption
 * reads a role out of the SESSION's organization, and the org here came from a
 * URL; asking org A's role about org B's page is the cross-tenant confusion the
 * slug lookup exists to prevent.
 */
export function decideSiteViewer<C extends SiteViewerContact>(
	input: SiteViewerInputs<C>
): SiteViewerDecision<C> | null {
	const { orgId, userId, contact } = input;

	if (!orgId) return null;
	if (!userId) return null;
	if (!contact) return null;

	// Defence in depth. `by_orgId_and_authUserId` should make a foreign row
	// unreachable, so this guard is unreachable too — which is the point. The
	// module this serves names widening on bad input as the one failure that
	// shows someone else's work, and a pure function that trusts its caller to
	// have queried correctly is a widening waiting for a future caller that
	// does not.
	if (contact.orgId !== orgId) return null;

	if (contact.portalAccess !== 'active') return null;

	return { orgId, userId, contact };
}
