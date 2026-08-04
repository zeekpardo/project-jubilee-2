import { describe, expect, it } from 'vitest';

import {
	assignableRoles,
	can,
	canAccessAdmin,
	ROLES,
	visibleCampaignIds,
	type Access,
	type Role
} from './permissions';

const access = (role: Role | null, assignedCampaignIds: string[] = []): Access => ({
	role,
	assignedCampaignIds
});

describe('owner', () => {
	it('can do everything, including org and billing', () => {
		const owner = access('owner');
		expect(can(owner, 'org:manage')).toBe(true);
		expect(can(owner, 'billing:manage')).toBe(true);
		expect(can(owner, 'members:manage')).toBe(true);
		expect(can(owner, 'money:write', 'any-campaign')).toBe(true);
		expect(can(owner, 'content:publish', 'any-campaign')).toBe(true);
	});
});

describe('admin', () => {
	const admin = access('admin');

	it('is denied org settings and billing', () => {
		expect(can(admin, 'org:manage')).toBe(false);
		expect(can(admin, 'billing:manage')).toBe(false);
	});

	it('has everything else, across all campaigns', () => {
		expect(can(admin, 'members:manage')).toBe(true);
		expect(can(admin, 'campaign:create')).toBe(true);
		expect(can(admin, 'projects:write', 'campaign-nobody-assigned-them-to')).toBe(true);
		expect(can(admin, 'content:publish', 'campaign-nobody-assigned-them-to')).toBe(true);
	});
});

describe('campaign manager', () => {
	const manager = access('campaign_manager', ['c1']);

	it('runs its own campaigns, settings included', () => {
		expect(can(manager, 'campaign:edit', 'c1')).toBe(true);
		expect(can(manager, 'projects:write', 'c1')).toBe(true);
		expect(can(manager, 'money:write', 'c1')).toBe(true);
		expect(can(manager, 'content:publish', 'c1')).toBe(true);
	});

	it('stops at the campaigns it is assigned to', () => {
		expect(can(manager, 'campaign:edit', 'c2')).toBe(false);
		expect(can(manager, 'projects:read', 'c2')).toBe(false);
		expect(can(manager, 'content:publish', 'c2')).toBe(false);
	});

	it('cannot create, delete or configure the org', () => {
		expect(can(manager, 'campaign:create')).toBe(false);
		expect(can(manager, 'campaign:delete')).toBe(false);
		expect(can(manager, 'members:manage')).toBe(false);
		expect(can(manager, 'settings:manage')).toBe(false);
		expect(can(manager, 'org:manage')).toBe(false);
	});
});

describe('team leader', () => {
	const leader = access('team_leader', ['c1', 'c2']);

	it('works only in assigned campaigns', () => {
		expect(can(leader, 'projects:write', 'c1')).toBe(true);
		expect(can(leader, 'projects:write', 'c2')).toBe(true);
		expect(can(leader, 'projects:write', 'c3')).toBe(false);
	});

	it('cannot change the campaign itself, which is what separates it from a manager', () => {
		expect(can(leader, 'campaign:edit', 'c1')).toBe(false);
		expect(can(access('campaign_manager', ['c1']), 'campaign:edit', 'c1')).toBe(true);
	});

	it('may write in its campaigns but never publish, which is the safety split', () => {
		// The whole point of content:publish. A team leader writes the post about
		// the family they visited; someone else decides it goes to the public
		// site. Free prose cannot be policed by a denylist, so a second pair of
		// eyes is the control.
		expect(can(leader, 'projects:write', 'c1')).toBe(true);
		expect(can(leader, 'content:publish', 'c1')).toBe(false);
		expect(can(leader, 'content:publish')).toBe(false);
	});

	it('cannot do org-wide things', () => {
		expect(can(leader, 'members:manage')).toBe(false);
		expect(can(leader, 'campaign:create')).toBe(false);
		expect(can(leader, 'campaign:delete')).toBe(false);
		expect(can(leader, 'settings:manage')).toBe(false);
		expect(can(leader, 'org:manage')).toBe(false);
		expect(can(leader, 'billing:manage')).toBe(false);
	});

	it('answers "anywhere at all" for nav, without a campaign', () => {
		expect(can(leader, 'projects:read')).toBe(true);
		expect(can(access('team_leader', []), 'projects:read')).toBe(false);
	});

	it('is still a team leader with no assignments, just with nothing to do', () => {
		const unassigned = access('team_leader', []);
		expect(canAccessAdmin(unassigned)).toBe(true);
		expect(can(unassigned, 'projects:read', 'c1')).toBe(false);
	});
});

describe('portal member', () => {
	const portal = access('portal_member', ['c1']);

	it('never reaches the admin app, however it was assigned', () => {
		expect(canAccessAdmin(portal)).toBe(false);
		expect(visibleCampaignIds(portal, ['c1'])).toEqual([]);
	});

	it('holds no capability at all — what it may see is an ownership question', () => {
		expect(can(portal, 'projects:read', 'c1')).toBe(false);
		expect(can(portal, 'contacts:read')).toBe(false);
		expect(can(portal, 'money:read', 'c1')).toBe(false);
	});
});

describe('member and unauthenticated', () => {
	it('has no admin access', () => {
		expect(canAccessAdmin(access('member'))).toBe(false);
		expect(can(access('member'), 'projects:read', 'c1')).toBe(false);
	});

	it('treats a null role as no access', () => {
		expect(canAccessAdmin(access(null))).toBe(false);
		expect(can(access(null), 'projects:read', 'c1')).toBe(false);
		expect(can(access(null), 'org:manage')).toBe(false);
	});
});

describe('visibleCampaignIds', () => {
	const all = ['c1', 'c2', 'c3'];

	it('gives owner and admin everything', () => {
		expect(visibleCampaignIds(access('owner'), all)).toEqual(all);
		expect(visibleCampaignIds(access('admin'), all)).toEqual(all);
	});

	it('narrows the assigned roles to their assignments', () => {
		expect(visibleCampaignIds(access('team_leader', ['c2']), all)).toEqual(['c2']);
		expect(visibleCampaignIds(access('campaign_manager', ['c3']), all)).toEqual(['c3']);
	});

	it('ignores an assignment to a campaign that no longer exists', () => {
		expect(visibleCampaignIds(access('team_leader', ['c2', 'deleted']), all)).toEqual(['c2']);
	});

	it('gives a member nothing', () => {
		expect(visibleCampaignIds(access('member'), all)).toEqual([]);
	});
});

describe('assignableRoles', () => {
	it('lets only an owner create another owner', () => {
		expect(assignableRoles('owner')).toContain('owner');
		expect(assignableRoles('admin')).not.toContain('owner');
	});

	it('does not let an admin create another admin', () => {
		expect(assignableRoles('admin')).toEqual([
			'campaign_manager',
			'team_leader',
			'portal_member',
			'member'
		]);
	});

	it('gives lower roles nothing to assign', () => {
		expect(assignableRoles('campaign_manager')).toEqual([]);
		expect(assignableRoles('team_leader')).toEqual([]);
		expect(assignableRoles('portal_member')).toEqual([]);
		expect(assignableRoles('member')).toEqual([]);
		expect(assignableRoles(null)).toEqual([]);
	});
});

describe('the grant table itself', () => {
	it('answers every capability from a written grant, not from a role short-circuit', () => {
		// The shape this replaced: `can()` early-returned true for owner and then
		// for admin before consulting any list, so a capability added to the type
		// was held by both the moment it existed. Now each role answers from its
		// own row, and a capability nobody was granted is held by nobody.
		expect(ROLES.filter((role) => can(access(role, ['c1']), 'billing:manage'))).toEqual(['owner']);
		expect(ROLES.filter((role) => can(access(role, ['c1']), 'campaign:edit', 'c1'))).toEqual([
			'owner',
			'admin',
			'campaign_manager'
		]);
		// Publishing is held by exactly the three roles that were written down,
		// and by no role that merely happens to work in the campaign.
		expect(ROLES.filter((role) => can(access(role, ['c1']), 'content:publish', 'c1'))).toEqual([
			'owner',
			'admin',
			'campaign_manager'
		]);
		expect(ROLES.filter((role) => can(access(role, ['c1']), 'settings:manage'))).toEqual([
			'owner',
			'admin'
		]);
	});

	it('separates reaching the admin app from holding capabilities', () => {
		expect(canAccessAdmin(access('campaign_manager'))).toBe(true);
		expect(canAccessAdmin(access('team_leader'))).toBe(true);
		expect(canAccessAdmin(access('portal_member'))).toBe(false);
	});
});
