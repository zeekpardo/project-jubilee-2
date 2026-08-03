import { query } from '../_generated/server';
import { getAccess } from '../model/access';
import { canAccessAdmin } from '../../lib/domain/permissions';

/**
 * The caller's own org's public slug, or null when it never claimed one.
 *
 * Exists for `/portal`, which is now a redirector: it has no org in its URL to
 * resolve, so the only question it can ask is "where should THIS SESSION go",
 * and it forwards to `/{slug}/me`.
 *
 * READ THE NEXT SENTENCE BEFORE COPYING THIS. It takes the org from the
 * session's active organization, which everything else on the signed-in site
 * deliberately does not do — `resolveSiteViewer` exists precisely to avoid it,
 * because a session-derived org served under a URL that names a different one
 * is a cross-tenant leak. The difference here is that there is no URL to
 * disagree with: this is the one surface whose whole job is to answer where the
 * session belongs. Anything that already has an `orgSlug` must resolve through
 * `resolveSiteViewer` instead.
 *
 * No capability gate beyond holding an active org. The slug is not a secret —
 * it is the first segment of every public URL that org has — and the caller
 * only ever learns their own. Gating it on `canAccessAdmin`, as
 * `getOrgSettings` below does, would return null to exactly the audience that
 * needs it: a portal member with no admin rights at all.
 *
 * Null rather than a throw for a slug-less org. That org has no public site and
 * therefore no `/{orgSlug}/me`, which is a real state its members can be in and
 * something the caller has to render, not an error.
 */
export const getMyOrgSlug = query({
	args: {},
	handler: async (ctx): Promise<string | null> => {
		const access = await getAccess(ctx);
		if (!access.orgId) return null;

		const orgId = access.orgId;
		const settings = await ctx.db
			.query('orgSettings')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.unique();
		return settings?.slug ?? null;
	}
});

// This carries the org's campaign label and public profile, which the whole
// admin shell reads before any one capability is known, so it gates on "may
// this person reach the admin app at all" rather than on a specific
// capability — that would blank the shell for a team leader with no
// assignments yet.
export const getOrgSettings = query({
	args: {},
	handler: async (ctx) => {
		const access = await getAccess(ctx);
		if (!access.orgId || !canAccessAdmin(access)) {
			return null;
		}

		const orgId = access.orgId;
		return await ctx.db
			.query('orgSettings')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.unique();
	}
});
