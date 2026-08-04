// Roles and capabilities. Pure — no db, no framework — so both the Convex
// functions and the UI decide access from the same rules.
//
// Roles are stored explicitly on the membership, never derived from whether a
// user happens to have assignment rows. A team leader with no campaigns yet is
// still a team leader, and a role change is one write rather than an inferred
// side effect.
//
// THE PORTAL IS NOT IN HERE, deliberately. `can()` answers "may this role do
// this, here"; a portal read asks "is this row mine", which is a question about
// a single person's connections rather than about their role, and forcing it
// through this function would mean inventing capabilities like
// `portal:viewOwnGiving` that every admin would hold for no reason. Role
// decides which SURFACE someone reaches — `canAccessAdmin` below — and
// ownership decides which rows they see once there.

export type Role =
	| 'owner'
	| 'admin'
	| 'campaign_manager'
	| 'team_leader'
	| 'portal_member'
	| 'member';

/** Widest reach first. Pickers render in this order. */
export const ROLES: Role[] = [
	'owner',
	'admin',
	'campaign_manager',
	'team_leader',
	'portal_member',
	'member'
];

export function isRole(value: string | null | undefined): value is Role {
	return value !== null && value !== undefined && (ROLES as string[]).includes(value);
}

/**
 * Everything the admin app gates on. Capabilities are coarse on purpose: one
 * name per thing a person can do, so a screen asks a question rather than
 * re-deriving a rule.
 */
export type Capability =
	// Org identity and money owed to us — owner only.
	| 'org:manage'
	| 'billing:manage'
	// Who is in the org and what they may do.
	| 'members:manage'
	// Campaign lifecycle.
	| 'campaign:create'
	| 'campaign:delete'
	// Per-campaign work. Scoped for team leaders, org-wide for owner/admin.
	| 'campaign:edit'
	| 'projects:read'
	| 'projects:write'
	| 'contacts:read'
	| 'contacts:write'
	| 'money:read'
	| 'money:write'
	// Deciding that something written goes out to the public site. Separate
	// from writing it — see TEAM_LEADER_DENIED.
	| 'content:publish'
	| 'settings:manage';

const OWNER_ONLY: Capability[] = ['org:manage', 'billing:manage'];

const ORG_WIDE: Capability[] = [
	'members:manage',
	'campaign:create',
	'campaign:delete',
	'settings:manage'
];

const CAMPAIGN_SCOPED: Capability[] = [
	'campaign:edit',
	'projects:read',
	'projects:write',
	'contacts:read',
	'contacts:write',
	'money:read',
	'money:write',
	'content:publish'
];

/**
 * Campaign-scoped work a team leader does NOT hold. Two capabilities, for two
 * different reasons.
 *
 * `campaign:edit` is seniority: a team leader works in a campaign, a campaign
 * manager runs it.
 *
 * `content:publish` is a SAFETY CONTROL, and the reason it exists. Writing an
 * update rides the existing capability of its parent — `projects:write` for a
 * project update, `campaign:edit` for a campaign one — so the field team leader
 * who visited the family can write the post. Deciding it goes public is a
 * separate right, which means someone else decides. That split is deliberate:
 * an update is free prose and photographs about a named family, and this app
 * serves people escaping forced labour. `isProtectedFieldKey` can police custom
 * fields because fields have keys; a paragraph has none, so no denylist can
 * look at a sentence naming a brick kiln, and no sanitizer can look at a face
 * in a photograph, and decide either is safe to publish. A second pair of eyes
 * before the post goes out is the only control that actually exists here.
 */
const TEAM_LEADER_DENIED: Capability[] = ['campaign:edit', 'content:publish'];

/** Every capability there is, assembled from the three reach buckets. */
const ALL: Capability[] = [...OWNER_ONLY, ...ORG_WIDE, ...CAMPAIGN_SCOPED];

export function isCampaignScoped(capability: Capability): boolean {
	return CAMPAIGN_SCOPED.includes(capability);
}

/**
 * What each role is granted, named one role at a time.
 *
 * This used to be three early returns — `owner` true, `admin` true unless
 * owner-only — which meant a capability added later was granted to both before
 * anyone decided it should be. That is harmless while every capability is a
 * staff capability and every role that holds any is trusted staff. It stops
 * being harmless the moment a role exists that is an org member and NOT
 * trusted, because then "we forgot to list it" and "we granted it" look
 * identical from here.
 *
 * So a new capability is granted to nobody until it is written down. `owner`
 * lists `ALL` deliberately rather than short-circuiting: adding a capability to
 * the type without adding it to a bucket makes it appear in nobody's grant,
 * which is the failure we want.
 */
const GRANTS: Record<Role, Capability[]> = {
	owner: ALL,
	admin: ALL.filter((capability) => !OWNER_ONLY.includes(capability)),
	// The campaigns they are assigned to, including the campaign's own settings.
	campaign_manager: CAMPAIGN_SCOPED,
	// The same campaigns, but neither the campaign's important details nor the
	// decision to publish — the two capabilities that separate the roles.
	team_leader: CAMPAIGN_SCOPED.filter((capability) => !TEAM_LEADER_DENIED.includes(capability)),
	// Only the items they are part of, and that is an ownership question rather
	// than a capability one — see the header.
	portal_member: [],
	member: []
};

/** Roles whose campaign-scoped work is every campaign, not an assigned list. */
const UNSCOPED_ROLES: Role[] = ['owner', 'admin'];

/** Who the caller is, as far as access is concerned. */
export interface Access {
	role: Role | null;
	/** Campaign ids a team leader is assigned to. Ignored for owner/admin. */
	assignedCampaignIds: string[];
}

/**
 * May this person do this, and — for campaign-scoped work — may they do it
 * here? Omitting campaignId on a scoped capability asks "anywhere at all",
 * which is what nav items need.
 */
export function can(access: Access, capability: Capability, campaignId?: string | null): boolean {
	const { role } = access;
	if (!role) return false;

	if (!GRANTS[role].includes(capability)) return false;
	if (!CAMPAIGN_SCOPED.includes(capability)) return true;
	if (UNSCOPED_ROLES.includes(role)) return true;

	if (campaignId === undefined || campaignId === null) {
		return access.assignedCampaignIds.length > 0;
	}
	return access.assignedCampaignIds.includes(campaignId);
}

/**
 * Roles that may reach `/app`. Written out rather than derived from "holds any
 * capability", because the surface a person lands on is a decision in its own
 * right: `/app` is for staff, `/portal` is for everyone else, and that stays
 * true however the grants above are edited later.
 */
const ADMIN_ROLES: Role[] = ['owner', 'admin', 'campaign_manager', 'team_leader'];

/** Roles scoped to their campaign assignments rather than to the whole org. */
const ASSIGNED_ROLES: Role[] = ['campaign_manager', 'team_leader'];

/**
 * True when this role's reach IS its campaign assignments — so the UI knows
 * whether to offer an assignment control, and whether an empty workspace means
 * "nothing here yet" or "nobody has assigned you anything".
 */
export function isAssignedRole(role: Role | null): boolean {
	return role !== null && ASSIGNED_ROLES.includes(role);
}

/** Campaigns this person may work in, given every campaign in the org. */
export function visibleCampaignIds(access: Access, allCampaignIds: string[]): string[] {
	const { role } = access;
	if (!role) return [];
	if (UNSCOPED_ROLES.includes(role)) return allCampaignIds;
	if (!ASSIGNED_ROLES.includes(role)) return [];
	return allCampaignIds.filter((id) => access.assignedCampaignIds.includes(id));
}

/** True when the person may reach the admin app at all. */
export function canAccessAdmin(access: Access): boolean {
	return access.role !== null && ADMIN_ROLES.includes(access.role);
}

export const ROLE_LABELS: Record<Role, string> = {
	owner: 'Owner',
	admin: 'Admin',
	campaign_manager: 'Campaign Manager',
	team_leader: 'Team Leader',
	portal_member: 'Portal Member',
	member: 'Member'
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
	owner: 'Full access, including organization settings and billing.',
	admin: 'Full access except organization settings and billing.',
	campaign_manager: 'Runs the campaigns they are assigned to, settings included.',
	team_leader:
		'Works in the campaigns they are assigned to. Cannot change the campaign itself, and cannot publish an update to the public site.',
	portal_member: 'No admin access. Sees only their own items, in the portal.',
	member: 'No admin access.'
};

/**
 * Roles a given role may hand out. Nobody may create an owner but an owner.
 *
 * Where this is enforced, precisely:
 *  - The UI builds its role picker from this list alone, so it cannot offer
 *    more.
 *  - `access/mutations.ts setMemberRole` re-checks it before authorising.
 *  - Better Auth independently refuses to let a non-owner set or modify the
 *    owner role, so owner escalation is blocked at the write itself.
 *
 * The gap: the role write goes to Better Auth, whose `admin` holds
 * `member:update`, so an admin calling that endpoint directly could still make
 * a peer an admin — lateral, never upward. Closing it needs Better Auth to
 * expose the acting member's role to `beforeUpdateMemberRole`, which today it
 * does not.
 */
export function assignableRoles(role: Role | null): Role[] {
	if (role === 'owner') return [...ROLES];
	if (role === 'admin') return ['campaign_manager', 'team_leader', 'portal_member', 'member'];
	return [];
}
