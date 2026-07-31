import type { Doc } from '$convex/_generated/dataModel';
import * as m from '$lib/i18n/messages';

export type DocumentKind = Doc<'documents'>['kind'];
export type ProjectMemberRole = Doc<'projectMembers'>['role'];

export const DOCUMENT_KINDS: DocumentKind[] = [
	'debt_evidence',
	'receipt',
	'legal_certificate',
	'photo',
	'agreement',
	'other'
];

export const PROJECT_MEMBER_ROLES = [
	'team_lead',
	'leader',
	'attendee',
	'member',
	'volunteer'
] as const;

// Paraglide has no dynamic key access, so the union is mapped explicitly.
export function documentKindLabel(kind: DocumentKind): string {
	switch (kind) {
		case 'debt_evidence':
			return m.projects_documentKind_debt_evidence();
		case 'receipt':
			return m.projects_documentKind_receipt();
		case 'legal_certificate':
			return m.projects_documentKind_legal_certificate();
		case 'photo':
			return m.projects_documentKind_photo();
		case 'agreement':
			return m.projects_documentKind_agreement();
		case 'other':
			return m.projects_documentKind_other();
	}
}

// The role column is open text, so an unrecognised value shows as stored
// rather than disappearing.
export function projectMemberRoleLabel(role: string): string {
	switch (role) {
		case 'team_lead':
			return m.projectRole_team_lead();
		case 'leader':
			return m.projectRole_leader();
		case 'attendee':
			return m.projectRole_attendee();
		case 'member':
			return m.projectRole_member();
		case 'volunteer':
			return m.projectRole_volunteer();
		default:
			return role;
	}
}
