import * as m from '$lib/i18n/messages';

const SECTION_LABELS: Record<string, () => string> = {
	overview: m.nav_section_overview,
	admin: m.nav_section_admin
};

const ITEM_LABELS: Record<string, () => string> = {
	dashboard: m.nav_dashboard,
	projects: m.nav_projects,
	tasks: m.nav_tasks,
	adminTasks: m.nav_adminTasks,
	campaignContacts: m.campaignContacts_title,
	budget: m.nav_budget,
	contacts: m.nav_contacts,
	households: m.nav_households,
	campaigns: m.nav_campaigns,
	members: m.nav_members,
	settings: m.nav_settings,
	organization: m.nav_organization,
	publicSite: m.nav_publicSite,
	giving: m.nav_giving
};

export function sectionLabel(key: string): string {
	return SECTION_LABELS[key]?.() ?? key;
}

export function itemLabel(key: string): string {
	return ITEM_LABELS[key]?.() ?? key;
}
