// Roles and capabilities. Pure — no db, no framework — so both the Convex
// functions and the UI decide access from the same rules.
//
// Roles are stored explicitly on the membership, never derived from whether a
// user happens to have assignment rows. A team leader with no campaigns yet is
// still a team leader, and a role change is one write rather than an inferred
// side effect.

export type Role = 'owner' | 'admin' | 'team_leader' | 'member';

export const ROLES: Role[] = ['owner', 'admin', 'team_leader', 'member'];

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
	'money:write'
];

export function isCampaignScoped(capability: Capability): boolean {
	return CAMPAIGN_SCOPED.includes(capability);
}

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

	if (role === 'owner') return true;

	if (OWNER_ONLY.includes(capability)) return false;

	if (role === 'admin') return true;

	if (role === 'team_leader') {
		if (ORG_WIDE.includes(capability)) return false;
		if (!CAMPAIGN_SCOPED.includes(capability)) return false;
		if (campaignId === undefined || campaignId === null) {
			return access.assignedCampaignIds.length > 0;
		}
		return access.assignedCampaignIds.includes(campaignId);
	}

	// 'member' has no admin access at all; the donor portal is a separate
	// surface with its own rules.
	return false;
}

/** Campaigns this person may work in, given every campaign in the org. */
export function visibleCampaignIds(access: Access, allCampaignIds: string[]): string[] {
	if (access.role === 'owner' || access.role === 'admin') return allCampaignIds;
	if (access.role === 'team_leader') {
		return allCampaignIds.filter((id) => access.assignedCampaignIds.includes(id));
	}
	return [];
}

/** True when the person may reach the admin app at all. */
export function canAccessAdmin(access: Access): boolean {
	return access.role === 'owner' || access.role === 'admin' || access.role === 'team_leader';
}

export const ROLE_LABELS: Record<Role, string> = {
	owner: 'Owner',
	admin: 'Admin',
	team_leader: 'Team Leader',
	member: 'Member'
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
	owner: 'Full access, including organization settings and billing.',
	admin: 'Full access except organization settings and billing.',
	team_leader: 'Manages only the campaigns they are assigned to.',
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
	if (role === 'owner') return ['owner', 'admin', 'team_leader', 'member'];
	if (role === 'admin') return ['team_leader', 'member'];
	return [];
}
