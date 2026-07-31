import type { Role } from '$lib/domain/permissions';
import * as m from '$lib/i18n/messages';

export function roleLabel(role: Role): string {
	if (role === 'owner') return m.role_owner();
	if (role === 'admin') return m.role_admin();
	if (role === 'team_leader') return m.role_teamLeader();
	return m.role_member();
}

export function roleBadgeVariant(role: Role): 'default' | 'warning' | 'secondary' | 'outline' {
	if (role === 'owner') return 'default';
	if (role === 'admin') return 'warning';
	if (role === 'team_leader') return 'secondary';
	return 'outline';
}
