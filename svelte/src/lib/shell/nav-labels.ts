import * as m from '$lib/i18n/messages';

const SECTION_LABELS: Record<string, () => string> = {
	overview: m.nav_section_overview,
	admin: m.nav_section_admin
};

const ITEM_LABELS: Record<string, () => string> = {
	dashboard: m.nav_dashboard,
	projects: m.nav_projects,
	money: m.nav_money,
	contacts: m.nav_contacts,
	households: m.nav_households,
	campaigns: m.nav_campaigns,
	members: m.nav_members,
	settings: m.nav_settings,
	organization: m.nav_organization
};

export function sectionLabel(key: string): string {
	return SECTION_LABELS[key]?.() ?? key;
}

export function itemLabel(key: string): string {
	return ITEM_LABELS[key]?.() ?? key;
}
