// Labels and badge variants for every workflow enum.
//
// Paraglide has no dynamic key access, so every union is mapped with an
// exhaustive switch — the same shape features/checkins/labels.ts uses. A kind
// added to the union becomes a TypeScript error here rather than a raw
// `stage_change` rendered to an administrator.
//
// Variants are chosen HERE and never inline, so "archived" cannot be neutral
// on the list and urgent in the editor header.

import * as m from '$lib/i18n/messages';
import type { BadgeVariant } from '$lib/primitives/ui/badge';
import type { HouseholdFact } from '$lib/domain/workflows';
import type {
	CaptureChoice,
	PromptRole,
	WorkflowStatus,
	WorkflowTrigger,
	WorkflowTriggerKind
} from './types';

/** The order the status filter and every status badge use. */
export const WORKFLOW_STATUSES = [
	'draft',
	'published',
	'archived'
] as const satisfies readonly WorkflowStatus[];

export function workflowStatusLabel(status: WorkflowStatus): string {
	switch (status) {
		case 'draft':
			return m.workflows_status_draft();
		case 'published':
			return m.workflows_status_published();
		case 'archived':
			return m.workflows_status_archived();
	}
}

/**
 * `published` is the only filled-success badge: it is the one status that
 * means a family can be talked to under this configuration right now.
 * `archived` is outline rather than destructive — an archived workflow is
 * retired, not broken, and its versions are still replayable.
 */
export function workflowStatusVariant(status: WorkflowStatus): BadgeVariant {
	switch (status) {
		case 'draft':
			return 'secondary';
		case 'published':
			return 'success';
		case 'archived':
			return 'outline';
	}
}

/** The order the trigger picker offers, matching PLAN-workflows.md §5. */
export const WORKFLOW_TRIGGER_KINDS = [
	'manual',
	'stage_change',
	'schedule'
] as const satisfies readonly WorkflowTriggerKind[];

export function triggerKindLabel(kind: WorkflowTriggerKind): string {
	switch (kind) {
		case 'manual':
			return m.workflows_trigger_manual();
		case 'stage_change':
			return m.workflows_trigger_stageChange();
		case 'schedule':
			return m.workflows_trigger_schedule();
	}
}

export function triggerKindHelp(kind: WorkflowTriggerKind): string {
	switch (kind) {
		case 'manual':
			return m.workflows_trigger_manualHelp();
		case 'stage_change':
			return m.workflows_trigger_stageChangeHelp();
		case 'schedule':
			return m.workflows_trigger_scheduleHelp();
	}
}

/**
 * One line for a list row. The stage is shown by its LABEL when the campaign's
 * stages are to hand and by its key when they are not — a row that says
 * `freed` is still true, where a row that silently said "Stage change" would
 * hide which stage.
 */
export function triggerSummary(
	trigger: WorkflowTrigger,
	stageLabel?: (key: string) => string | undefined
): string {
	switch (trigger.kind) {
		case 'manual':
			return m.workflows_trigger_manual();
		case 'stage_change':
			return m.workflows_triggerSummary_stage({
				stage: stageLabel?.(trigger.stageKey) ?? trigger.stageKey
			});
		case 'schedule':
			return m.workflows_triggerSummary_schedule({ months: trigger.everyMonths });
	}
}

export const CAPTURE_CHOICES = [
	'none',
	'project',
	'contact'
] as const satisfies readonly CaptureChoice[];

export function captureChoiceLabel(choice: CaptureChoice): string {
	switch (choice) {
		case 'none':
			return m.workflows_capture_none();
		case 'project':
			return m.workflows_capture_project();
		case 'contact':
			return m.workflows_capture_contact();
	}
}

export function householdFactLabel(fact: HouseholdFact): string {
	switch (fact) {
		case 'hasChildren':
			return m.workflows_fact_hasChildren();
		case 'hasSchoolAgeChildren':
			return m.workflows_fact_hasSchoolAgeChildren();
	}
}

/** Responder first: it is the one whose words a family actually reads. */
export const PROMPT_ROLES = [
	'responder',
	'judge',
	'drafter'
] as const satisfies readonly PromptRole[];

export function promptRoleLabel(role: PromptRole): string {
	switch (role) {
		case 'responder':
			return m.workflows_role_responder();
		case 'judge':
			return m.workflows_role_judge();
		case 'drafter':
			return m.workflows_role_drafter();
	}
}

export function promptRoleHelp(role: PromptRole): string {
	switch (role) {
		case 'responder':
			return m.workflows_roleHelp_responder();
		case 'judge':
			return m.workflows_roleHelp_judge();
		case 'drafter':
			return m.workflows_roleHelp_drafter();
	}
}
