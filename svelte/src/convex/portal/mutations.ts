// ============================================================
// Writing from, and about, the portal
// ============================================================
// Two audiences in one file, and they gate differently.
//
// The portal member's own writes resolve the viewer from the session and touch
// nothing but their own row. `updatePortalProfile` takes no contactId, for the
// same reason nothing in portal/queries.ts does.
//
// The admin's writes — inviting someone, withdrawing it — gate on
// `members:manage`. Granting a person the ability to sign in is member
// management, not contact editing, and it is the write that creates the first
// org member who is not trusted staff.
// ============================================================

import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import { requireCapability } from '../model/access';
import {
	claimPortalContact,
	offerPortalAccess,
	requireInvitableContact,
	resolvePortalViewer,
	revokePortalAccess
} from '../model/identity';
import { getAccess } from '../model/access';
import { authComponent } from '../auth';
import { PORTAL_EDITABLE_PROFILE_FIELDS } from '../model/portal';

/**
 * Bind the signed-in account to the contact it was invited as.
 *
 * Called by the portal layout on load rather than by a sign-in hook: the claim
 * needs an ACTIVE ORGANIZATION to scope the lookup, and that is only settled
 * once the invitation has been accepted and a session carries it. Running it
 * per load is safe because the claim is a compare-and-set on an unlinked
 * contact — the second call finds the contact already linked and returns it
 * unchanged.
 *
 * Returns whether the caller now has a portal identity, so the layout can
 * decide between the portal and a "nothing here for you" page without a second
 * round trip.
 */
export const claimPortalAccess = mutation({
	args: {},
	handler: async (ctx) => {
		const access = await getAccess(ctx);
		if (!access.orgId || !access.userId) return { claimed: false };

		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user) return { claimed: false };

		const contactId = await claimPortalContact(ctx, access.orgId, access.userId, user.email);
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
		const viewer = await resolvePortalViewer(ctx);
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
