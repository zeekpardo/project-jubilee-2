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

export const PROJECT_MEMBER_ROLES: ProjectMemberRole[] = ['subject', 'head', 'member'];

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

export function projectMemberRoleLabel(role: ProjectMemberRole): string {
	switch (role) {
		case 'subject':
			return m.projects_memberRole_subject();
		case 'head':
			return m.projects_memberRole_head();
		case 'member':
			return m.projects_memberRole_member();
	}
}
