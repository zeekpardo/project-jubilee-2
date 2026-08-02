import type { Role } from '$lib/domain/permissions';
import * as m from '$lib/i18n/messages';

export function roleLabel(role: Role): string {
	if (role === 'owner') return m.role_owner();
	if (role === 'admin') return m.role_admin();
	if (role === 'campaign_manager') return m.role_campaignManager();
	if (role === 'team_leader') return m.role_teamLeader();
	if (role === 'portal_member') return m.role_portalMember();
	return m.role_member();
}

export function roleBadgeVariant(role: Role): 'default' | 'warning' | 'secondary' | 'outline' {
	if (role === 'owner') return 'default';
	if (role === 'admin') return 'warning';
	// A campaign manager and a team leader share a badge on purpose: what
	// separates them is one capability inside their own campaigns, not their
	// standing in the org, and two shades of the same thing would read as more
	// difference than there is.
	if (role === 'campaign_manager' || role === 'team_leader') return 'secondary';
	return 'outline';
}
