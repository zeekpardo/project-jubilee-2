import { describe, expect, it } from 'vitest';

import {
	assignableRoles,
	can,
	canAccessAdmin,
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
	});
});

describe('team leader', () => {
	const leader = access('team_leader', ['c1', 'c2']);

	it('works only in assigned campaigns', () => {
		expect(can(leader, 'projects:write', 'c1')).toBe(true);
		expect(can(leader, 'projects:write', 'c2')).toBe(true);
		expect(can(leader, 'projects:write', 'c3')).toBe(false);
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

	it('narrows a team leader to their assignments', () => {
		expect(visibleCampaignIds(access('team_leader', ['c2']), all)).toEqual(['c2']);
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
		expect(assignableRoles('admin')).toEqual(['team_leader', 'member']);
	});

	it('gives lower roles nothing to assign', () => {
		expect(assignableRoles('team_leader')).toEqual([]);
		expect(assignableRoles('member')).toEqual([]);
		expect(assignableRoles(null)).toEqual([]);
	});
});
