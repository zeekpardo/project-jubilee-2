// Better Auth's organization plugin ships owner/admin/member. This app also
// has team_leader, so the roles are registered explicitly here and shared by
// the server config and the client, which must be given the same definitions
// or the client's permission checks disagree with the server's.
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
const team_leader = orgAc.newRole({
	...memberAc.statements,
	campaign: ['update']
});

const member = orgAc.newRole({ ...memberAc.statements });

export const orgRoles = { owner, admin, team_leader, member };
