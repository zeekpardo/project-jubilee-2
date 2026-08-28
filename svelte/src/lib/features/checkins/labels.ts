// Labels and badge variants for every check-in enum.
//
// Paraglide has no dynamic key access, so every union is mapped with an
// exhaustive switch — the same shape features/trips/labels.ts uses. A value
// added to the schema becomes a TypeScript error here rather than a raw
// `self_harm` rendered to a member of staff.
//
// Variants are chosen HERE and never inline, so "escalated" cannot be urgent on
// one screen and neutral on the next.

import * as m from '$lib/i18n/messages';
import type { BadgeVariant } from '$lib/primitives/ui/badge';
import { MAX_RESPONDER_TURNS } from '$lib/domain/checkin-objectives';
import type {
	CheckinKind,
	CheckinReviewReason,
	CheckinStatus,
	EscalationCategory,
	EscalationStatus,
	ObjectiveState,
	PromptRole
} from './types';

/** Filter order, and the order the kind options render in. */
export const CHECKIN_KINDS = ['direct', 'checkin'] as const satisfies readonly CheckinKind[];

export function checkinKindLabel(kind: CheckinKind): string {
	switch (kind) {
		case 'direct':
			return m.messages_kindDirect();
		case 'checkin':
			return m.messages_kindCheckin();
	}
}

/**
 * A quiet pair on purpose: the kind badge sits beside the status badge, and
 * status is the one carrying urgency. `outline` for a conversation between
 * people, `secondary` for the engine-run one — filled, so a transcript a model
 * is writing into never looks like plain correspondence, but never louder than
 * the `warning` and `destructive` a status can reach.
 */
export function checkinKindVariant(kind: CheckinKind): BadgeVariant {
	switch (kind) {
		case 'direct':
			return 'outline';
		case 'checkin':
			return 'secondary';
	}
}

/** List-filter order, and the order the status chips render in. */
export const CHECKIN_STATUSES = [
	'open',
	'needs_review',
	'escalated',
	'drafted',
	'closed'
] as const satisfies readonly CheckinStatus[];

export function checkinStatusLabel(status: CheckinStatus): string {
	switch (status) {
		case 'open':
			return m.checkinStatus_open();
		case 'needs_review':
			return m.checkinStatus_needs_review();
		case 'escalated':
			return m.checkinStatus_escalated();
		case 'drafted':
			return m.checkinStatus_drafted();
		case 'closed':
			return m.checkinStatus_closed();
	}
}

/**
 * `escalated` is the only DESTRUCTIVE variant in this feature, and it is
 * destructive on every surface that renders it. A family in danger must not be
 * a neutral grey pill in a list of five other neutral grey pills.
 *
 * `needs_review` is warning rather than destructive: it also wants a person,
 * but it is "we are unsure", not "someone is in trouble". Collapsing the two
 * would make the urgent one ordinary.
 */
export function checkinStatusVariant(status: CheckinStatus): BadgeVariant {
	switch (status) {
		case 'open':
			return 'secondary';
		case 'needs_review':
			return 'warning';
		case 'escalated':
			return 'destructive';
		case 'drafted':
			return 'success';
		case 'closed':
			return 'outline';
	}
}

export function reviewReasonLabel(reason: CheckinReviewReason): string {
	switch (reason) {
		case 'low_confidence':
			return m.reviewReason_low_confidence();
		case 'exhausted':
			return m.reviewReason_exhausted({ count: MAX_RESPONDER_TURNS });
		case 'draft_failed':
			return m.reviewReason_draft_failed();
		case 'model_error':
			return m.reviewReason_model_error();
	}
}

export function objectiveStateLabel(state: ObjectiveState): string {
	switch (state) {
		case 'answered':
			return m.objectiveState_answered();
		case 'needs_review':
			return m.objectiveState_needs_review();
		case 'unanswered':
			return m.objectiveState_unanswered();
	}
}

export function objectiveStateVariant(state: ObjectiveState): BadgeVariant {
	switch (state) {
		case 'answered':
			return 'success';
		case 'needs_review':
			return 'warning';
		case 'unanswered':
			return 'outline';
	}
}

/**
 * Every category is `destructive`. There is deliberately no ranking between
 * them — a medical emergency is not a lesser thing than a threat, and a UI that
 * implied one would be making a triage decision that belongs to the person
 * reading it.
 */
export function escalationCategoryLabel(category: EscalationCategory): string {
	switch (category) {
		case 'violence':
			return m.escalationCategory_violence();
		case 'abuse':
			return m.escalationCategory_abuse();
		case 'self_harm':
			return m.escalationCategory_self_harm();
		case 'trafficking':
			return m.escalationCategory_trafficking();
		case 'medical_emergency':
			return m.escalationCategory_medical_emergency();
		case 'child_danger':
			return m.escalationCategory_child_danger();
	}
}

export const ESCALATION_STATUSES = [
	'open',
	'acknowledged',
	'resolved'
] as const satisfies readonly EscalationStatus[];

export function escalationStatusLabel(status: EscalationStatus): string {
	switch (status) {
		case 'open':
			return m.escalation_status_open();
		case 'acknowledged':
			return m.escalation_status_acknowledged();
		case 'resolved':
			return m.escalation_status_resolved();
	}
}

export function escalationStatusVariant(status: EscalationStatus): BadgeVariant {
	switch (status) {
		case 'open':
			return 'destructive';
		case 'acknowledged':
			return 'warning';
		case 'resolved':
			return 'outline';
	}
}

export const PROMPT_ROLES = [
	'responder',
	'drafter',
	'judge'
] as const satisfies readonly PromptRole[];

export function promptRoleLabel(role: PromptRole): string {
	switch (role) {
		case 'responder':
			return m.checkinPromptRole_responder();
		case 'drafter':
			return m.checkinPromptRole_drafter();
		case 'judge':
			return m.checkinPromptRole_judge();
	}
}

export function turnRoleLabel(role: 'responder' | 'judge'): string {
	return role === 'responder' ? m.checkinTrace_role_responder() : m.checkinTrace_role_judge();
}
