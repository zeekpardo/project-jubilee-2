import * as m from '$lib/i18n/messages';

export const CAMPAIGN_ROLES = ['sponsor', 'attendee', 'lead', 'staff'] as const;

export type CampaignRole = (typeof CAMPAIGN_ROLES)[number];

const LABELS: Record<CampaignRole, () => string> = {
	sponsor: m.campaignRole_sponsor,
	attendee: m.campaignRole_attendee,
	lead: m.campaignRole_lead,
	staff: m.campaignRole_staff
};

/** Falls back to the stored string, since the role column is deliberately open. */
export function campaignRoleLabel(role: string): string {
	return LABELS[role as CampaignRole]?.() ?? role;
}
