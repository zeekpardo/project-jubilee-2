// ============================================================
// Reading the signed-in site
// ============================================================
// The reads that make a PUBLIC page recognize the person looking at it. Every
// handler here resolves the viewer through `resolveSiteViewer(ctx, orgSlug)`,
// which takes the org from the URL and the person from the session, and returns
// null unless both agree. Nothing in this file accepts an identity, and nothing
// may be added that does: no contactId, no userId, no orgId. Slugs and record
// numbers ARE arguments, because they are how the public site addresses itself
// — they name a page, never a person.
//
// A missing viewer is an EMPTY result, never an error. Nothing in this file
// throws. These queries run on pages that must render for an anonymous
// stranger, so signed-out, signed in at another org, and access revoked all
// arrive at the same answer as a page with no personalization on it — and a
// personalization query that failed loudly would take a working donation page
// down with it.
//
// THE PUBLICATION LINE. `getMyGivingForRecord` resolves a campaign and a
// project exactly as `public/queries.ts` does, `isPublished` checks included.
// Having given to a record does not make it visible: an unpublished record is
// one whose people have not agreed to be shown, and a signed-in route that
// answered for it would be a second way in past the wall. The rule is the same
// one `toPortalRecord` states — publishing gates a supporter.
//
// What these handlers are allowed to RETURN is decided in `model/site.ts`, in
// its header. This file resolves, gates and bounds; it does not project.
// ============================================================

import { v } from 'convex/values';
import { query } from '../_generated/server';
import { canAccessAdmin } from '../../lib/domain/permissions';
import { getAccess } from '../model/access';
import { resolveSiteViewer } from '../model/identity';
import {
	givingForRecord,
	toSiteGreeting,
	type SiteGivingForRecord,
	type SiteGreeting
} from '../model/site';

/**
 * Who is looking at this org's site, if anyone.
 *
 * Returns a name and nothing else — see `toSiteGreeting` for why the contact id
 * is deliberately absent. Null covers every way there is no viewer, with no
 * distinction between them: telling a browser "you are signed in but not known
 * here" is a fact about another org's membership, and this surface has no
 * reason to disclose one.
 */
export const getSiteViewer = query({
	args: { orgSlug: v.string() },
	handler: async (ctx, args): Promise<SiteGreeting | null> => {
		const viewer = await resolveSiteViewer(ctx, args.orgSlug);
		if (!viewer) return null;

		// THE ORG MATCH IS THE POINT. `getAccess` reports the role held in Better
		// Auth's ACTIVE organization, which this whole surface otherwise refuses
		// to consult — the viewer above came from the URL. Both are read here
		// precisely so they can be compared, and the answer is yes only when they
		// name the same org.
		//
		// Without that comparison the menu would offer a dashboard to someone who
		// administers a DIFFERENT org than the page they are reading, which is
		// reachable today: one person can be a donor here and staff elsewhere.
		// `/app` is session-scoped, so the link would have worked and taken them
		// somewhere else entirely — an offer that is not wrong so much as about
		// another organization, made on this one's page.
		const access = await getAccess(ctx);
		const canAdminister = access.orgId === viewer.orgId && canAccessAdmin(access);

		return toSiteGreeting(viewer.contact, canAdminister);
	}
});

/**
 * What the viewer has given to the record on screen: a project when
 * `projectNumber` is supplied, the whole campaign when it is not.
 *
 * Records are addressed by campaign slug and public `number`, the way the wall
 * addresses everything. No document id crosses this boundary in either
 * direction.
 *
 * The org is taken from the RESOLVED VIEWER rather than re-derived from the
 * slug. `resolveSiteViewer` already resolved `orgSlug` to an org and found this
 * person in it, so `orgIdForSlug` here would be a second read of the same row
 * and, worse, a second source of truth: if the two ever disagreed, this would
 * be summing one org's ledger against another org's campaign. One resolution,
 * used throughout.
 *
 * Null when there is no viewer, when the campaign or record is not published,
 * and when the viewer has given nothing to it. All four render as nothing at
 * all, which is what the page wants — there is no "no gifts yet" state here to
 * tell a reader they are not a supporter.
 */
export const getMyGivingForRecord = query({
	args: {
		orgSlug: v.string(),
		campaignSlug: v.string(),
		projectNumber: v.optional(v.string())
	},
	handler: async (ctx, args): Promise<SiteGivingForRecord | null> => {
		const viewer = await resolveSiteViewer(ctx, args.orgSlug);
		if (!viewer) return null;

		// Campaign slugs are unique per ORG, not globally, so the org is half of
		// the address — the same reason `resolvePublishedCampaign` on the public
		// side names both.
		const campaign = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId_and_slug', (q) =>
				q.eq('orgId', viewer.orgId).eq('slug', args.campaignSlug)
			)
			.first();
		if (!campaign || !campaign.isPublished) return null;

		const number = args.projectNumber;
		if (number === undefined) {
			return await givingForRecord(ctx, viewer, { campaignId: campaign._id });
		}

		const project = await ctx.db
			.query('projects')
			.withIndex('by_campaignId_and_number', (q) =>
				q.eq('campaignId', campaign._id).eq('number', number)
			)
			.first();
		// The publish check stays explicit: the index above is not scoped to it,
		// and this is the point where giving to a record could otherwise confirm
		// that an unpublished one exists.
		if (!project || !project.isPublished) return null;

		return await givingForRecord(ctx, viewer, {
			campaignId: campaign._id,
			projectId: project._id
		});
	}
});
