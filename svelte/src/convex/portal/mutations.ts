// ============================================================
// Writing from, and about, the portal
// ============================================================
// Two audiences in one file, and they gate differently.
//
// The portal member's own writes take `orgSlug`, resolve the org from it and
// the person from the session, and touch nothing but their own row.
// `updatePortalProfile` takes no contactId, for the same reason nothing in
// portal/queries.ts does: a slug says which org's page you are on, never who
// you are.
//
// The admin's writes — inviting someone, withdrawing it — gate on
// `members:manage` and take NO slug, deliberately. They are staff acting inside
// their own org, where the session's active organization is the correct and
// only source of the org: an admin's authority is a fact about their
// membership, not about which URL they are looking at, and letting a slug
// choose the org for a capability-gated write would be asking org A's role to
// authorize a write against org B.
// ============================================================

import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import { requireCapability } from '../model/access';
import {
	claimPortalContact,
	offerPortalAccess,
	requireInvitableContact,
	resolveSiteViewer,
	revokePortalAccess
} from '../model/identity';
import { orgIdForSlug } from '../model/public';
import { authComponent } from '../auth';
import { PORTAL_EDITABLE_PROFILE_FIELDS } from '../model/portal';

/**
 * Bind the signed-in account to the contact it was invited as, AT THE ORG THE
 * URL NAMES.
 *
 * The org comes from `orgSlug` and not from the session's active organization,
 * and here that is not merely tidiness: this write LINKS an account to a
 * contact row by matching email addresses. Claiming against the session's org
 * while standing on another org's page would bind the caller to whichever
 * contact happens to share their address in the wrong org — handing them that
 * person's giving, household and notes, permanently, in a single write. The
 * lookup and the page must name the same org or the link is a guess.
 *
 * Called by the layout on load rather than by a sign-in hook, because a claim
 * needs a session and an org together and that pairing is only settled once the
 * page knows which org it is. Running it per load is safe: the claim is a
 * compare-and-set on an UNLINKED contact, so the second call finds the contact
 * already linked and returns it unchanged.
 *
 * Returns whether the caller now has a portal identity at this org, so the
 * layout can decide between the portal and a "nothing here for you" page
 * without a second round trip.
 */
export const claimPortalAccess = mutation({
	args: { orgSlug: v.string() },
	handler: async (ctx, args) => {
		const orgId = await orgIdForSlug(ctx, args.orgSlug);
		if (!orgId) return { claimed: false };

		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user) return { claimed: false };

		const contactId = await claimPortalContact(ctx, orgId, user._id, user.email);
		return { claimed: contactId !== null };
	}
});

/**
 * A portal member correcting their own details.
 *
 * The whitelist is `PORTAL_EDITABLE_PROFILE_FIELDS`, and it is shorter than
 * what the same person can SEE. A donor fixing their address is ordinary; a
 * donor rewriting their own name is a dedup problem for whoever has to match
 * them next, and the org's copy of a name is not the org's to lose to a form.
 *
 * `null` clears a field and an absent argument leaves it alone, the same
 * convention `tasks/mutations.ts` uses and for the same reason: Convex cannot
 * tell an omitted argument from one passed as undefined.
 */
const clearable = v.optional(v.union(v.string(), v.null()));

export const updatePortalProfile = mutation({
	args: {
		orgSlug: v.string(),
		phone: clearable,
		addressLine1: clearable,
		addressLine2: clearable,
		city: clearable,
		state: clearable,
		postalCode: clearable,
		country: clearable,
		updateDetail: v.optional(v.union(v.literal('summary'), v.literal('full'), v.null())),
		preferredContact: v.optional(
			v.union(v.literal('email'), v.literal('mail'), v.literal('phone'), v.null())
		)
	},
	handler: async (ctx, args) => {
		const viewer = await resolveSiteViewer(ctx, args.orgSlug);
		if (!viewer) throw new ConvexError('No portal access');

		const patch: Record<string, string | undefined> = {};
		for (const field of PORTAL_EDITABLE_PROFILE_FIELDS) {
			const value = args[field];
			if (value === undefined) continue;
			patch[field] = value === null ? undefined : value;
		}

		if (Object.keys(patch).length > 0) {
			await ctx.db.patch('contacts', viewer.contact._id, patch);
		}
		return viewer.contact._id;
	}
});

/**
 * Offer a contact a portal login.
 *
 * This marks the contact and stamps the date; the invitation email itself is
 * Better Auth's, sent from the client against the organization plugin with the
 * `portal_member` role. Two systems, one moment, and the stamp lives in the
 * shared helper so a second invite path cannot forget it — which is exactly
 * what happened in the app this was ported from.
 */
export const invitePortalAccess = mutation({
	args: { contactId: v.id('contacts') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'members:manage');
		const contact = await requireInvitableContact(ctx, orgId, args.contactId);
		await offerPortalAccess(ctx, contact);
		return contact.emailLower ?? null;
	}
});

/**
 * Withdraw it. The person, their giving and their history stay; the link to
 * the account is cut and the state says why, so nothing has to guess later
 * whether they were never invited or were asked to leave.
 */
export const revokePortalAccessFor = mutation({
	args: { contactId: v.id('contacts') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'members:manage');
		const contact = await ctx.db.get('contacts', args.contactId);
		if (!contact || contact.orgId !== orgId) {
			throw new ConvexError('Contact not found');
		}
		await revokePortalAccess(ctx, contact);
		return contact._id;
	}
});
