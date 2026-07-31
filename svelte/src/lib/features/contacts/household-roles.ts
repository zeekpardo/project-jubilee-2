import * as m from '$lib/i18n/messages';

export const HOUSEHOLD_ROLES = ['parent_guardian', 'adult', 'other_adult', 'child'] as const;

export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

const LABELS: Record<HouseholdRole, () => string> = {
	parent_guardian: m.households_role_parent_guardian,
	adult: m.households_role_adult,
	other_adult: m.households_role_other_adult,
	child: m.households_role_child
};

export function householdRoleLabel(role: string): string {
	return LABELS[role as HouseholdRole]?.() ?? role;
}
