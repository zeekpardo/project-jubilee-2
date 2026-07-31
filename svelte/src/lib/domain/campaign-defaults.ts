// ============================================================
// Campaign defaults — the config a NEW campaign is born with (Phase 5)
// ============================================================
// A campaign is "self-configuring": created with editable defaults so it is
// usable immediately, then tailored. The create flow (features/campaigns) seeds
// these, scoped to the new campaign. Generic on purpose — the Jubilee seed has
// its own richer set; these are the sensible starting point for any campaign.
// ============================================================

import type { PipelineStageKind } from './stages';

export interface DefaultStage {
	key: string;
	label: string;
	order: number;
	kind: PipelineStageKind;
	accent: string;
	isDefault: boolean;
	isFundedGate: boolean;
	isSystem: boolean;
}

/** A generic funnel: intake → vetting → public → funded (the funded gate),
 * plus a cancelled off-ramp. Every campaign gets its own copy (keys are unique
 * per campaign). */
export const DEFAULT_PIPELINE_STAGES: DefaultStage[] = [
	{
		key: 'identified',
		label: 'Identified',
		order: 1,
		kind: 'funnel',
		accent: 'slate',
		isDefault: true,
		isFundedGate: false,
		isSystem: true
	},
	{
		key: 'vetted',
		label: 'Vetted',
		order: 2,
		kind: 'funnel',
		accent: 'sky',
		isDefault: false,
		isFundedGate: false,
		isSystem: true
	},
	{
		key: 'published',
		label: 'Published',
		order: 3,
		kind: 'funnel',
		accent: 'violet',
		isDefault: false,
		isFundedGate: false,
		isSystem: true
	},
	{
		key: 'funded',
		label: 'Funded',
		order: 4,
		kind: 'funnel',
		accent: 'amber',
		isDefault: false,
		isFundedGate: true,
		isSystem: true
	},
	{
		key: 'cancelled',
		label: 'Cancelled',
		order: 5,
		kind: 'terminal',
		accent: 'red',
		isDefault: false,
		isFundedGate: false,
		isSystem: true
	}
];

export interface DefaultStat {
	key: string;
	order: number;
	showOnDashboard: boolean;
	showOnPublic: boolean;
}

/** The campaign-agnostic stats: the goal-met count (label derives from the
 * campaign's goal wording), total raised, and project count. */
export const DEFAULT_CAMPAIGN_STATS: DefaultStat[] = [
	{ key: 'families_freed', order: 1, showOnDashboard: true, showOnPublic: true },
	{ key: 'total_raised', order: 2, showOnDashboard: true, showOnPublic: false },
	{ key: 'projects_count', order: 3, showOnDashboard: true, showOnPublic: false }
];
