// Better Auth's organization plugin ships owner/admin/member. This app also
// has campaign_manager, team_leader and portal_member, so the roles are
// registered explicitly here and shared by the server config and the client,
// which must be given the same definitions or the client's permission checks
// disagree with the server's.
//
// A role missing from this file is not a smaller role — `getAccess` treats an
// unrecognised role as NO access — so adding one is a three-way deploy: this
// file, ./permissions.ts, and the stored membership rows. Register it here
// before anything writes it.
//
// These grant Better Auth's own organization operations. What a role may do
// with campaigns, projects and money lives in ./permissions.ts, which is the
// rule the Convex functions and the UI both read.

import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, memberAc } from 'better-auth/plugins/organization/access';

export const orgStatement = {
	...defaultStatements,
	campaign: ['create', 'update', 'delete']
} as const;

export const orgAc = createAccessControl(orgStatement);

const owner = orgAc.newRole({
	organization: ['update', 'delete'],
	member: ['create', 'update', 'delete'],
	invitation: ['create', 'cancel'],
	team: ['create', 'update', 'delete'],
	ac: ['create', 'read', 'update', 'delete'],
	campaign: ['create', 'update', 'delete']
});

// Deliberately without organization:update/delete — org identity and billing
// are the one thing an admin may not touch.
const admin = orgAc.newRole({
	member: ['create', 'update', 'delete'],
	invitation: ['create', 'cancel'],
	team: ['create', 'update', 'delete'],
	ac: ['read'],
	campaign: ['create', 'update', 'delete']
});

// Scope comes from campaignAssignments, not from this grant.
const campaign_manager = orgAc.newRole({
	...memberAc.statements,
	campaign: ['update']
});

// The same campaigns as a campaign manager, without the campaign itself —
// which is the whole difference between the two roles, here and in
// ./permissions.ts.
const team_leader = orgAc.newRole({ ...memberAc.statements });

// A signed-in person who is not staff: a sponsor, a family member, an
// attendee. They hold no organization operation at all; what they may see is
// decided by what they are connected to, not by this grant.
const portal_member = orgAc.newRole({ ...memberAc.statements });

const member = orgAc.newRole({ ...memberAc.statements });

export const orgRoles = { owner, admin, campaign_manager, team_leader, portal_member, member };
