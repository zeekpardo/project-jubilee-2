// API
import { useQuery } from '@mmailaender/convex-svelte';
import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
import { getAuthContext } from '$lib/auth/context.svelte';

// Rules
import {
	can as canDo,
	canAccessAdmin,
	isAssignedRole,
	visibleCampaignIds,
	type Access,
	type Capability,
	type Role
} from '$lib/domain/permissions';

export type AccessData = {
	role: Role | null;
	assignedCampaignIds: string[];
	userId: string | null;
};

type UseAccessOptions = { initialData?: AccessData } | (() => { initialData?: AccessData });

/**
 * The caller's access, reading the same rules the Convex functions enforce, so
 * a hidden control and a rejected mutation can never disagree.
 */
export function useAccess(options?: UseAccessOptions) {
	const { api } = getAuthContext();
	const auth = useAuth();

	const getOptions = typeof options === 'function' ? options : () => options;
	const initial = getOptions()?.initialData;

	const response = useQuery(
		api.access.queries.getMyAccess,
		() => (auth.isAuthenticated ? {} : 'skip'),
		() => ({ initialData: initial })
	);

	const data = $derived((response?.data ?? initial) as AccessData | undefined);

	const access = $derived<Access>({
		role: data?.role ?? null,
		assignedCampaignIds: data?.assignedCampaignIds ?? []
	});

	return {
		get isLoading() {
			return response?.isLoading ?? false;
		},
		get role() {
			return access.role;
		},
		get userId() {
			return data?.userId ?? null;
		},
		get assignedCampaignIds() {
			return access.assignedCampaignIds;
		},
		get canAccessAdmin() {
			return canAccessAdmin(access);
		},
		get isOwner() {
			return access.role === 'owner';
		},
		get isAdmin() {
			return access.role === 'admin';
		},
		get isTeamLeader() {
			return access.role === 'team_leader';
		},
		/**
		 * Their reach IS their assignments — a campaign manager or a team leader.
		 * An empty workspace means something different for these two than for an
		 * admin: nobody has assigned them anything yet, rather than nothing exists.
		 */
		get isAssignedRole() {
			return isAssignedRole(access.role);
		},
		can(capability: Capability, campaignId?: string | null) {
			return canDo(access, capability, campaignId);
		},
		visibleCampaignIds(allCampaignIds: string[]) {
			return visibleCampaignIds(access, allCampaignIds);
		}
	};
}

export type AccessState = ReturnType<typeof useAccess>;
