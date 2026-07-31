import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import type { LayoutServerLoad } from './$types';
import { api } from '$convex/_generated/api';
import { building } from '$app/environment';
import { ACTIVE_CAMPAIGN_COOKIE } from '$lib/campaigns/active.svelte';
import { SIDEBAR_COOKIE, resolveSidebarOpen } from '$lib/shell/sidebar.svelte';

const empty = {
	access: { role: null, assignedCampaignIds: [], userId: null },
	campaigns: [],
	activeCampaignId: null
};

export const load = (async ({ locals, cookies }) => {
	// Read before the auth bail-out: the shell renders either way, and the width
	// has to be right in the very first byte of HTML.
	const sidebarOpen = resolveSidebarOpen(building ? undefined : cookies.get(SIDEBAR_COOKIE));

	if (building || !locals.token) return { ...empty, sidebarOpen };

	const client = createConvexHttpClient({ token: locals.token });

	const [access, campaigns] = await Promise.all([
		client.query(api.access.queries.getMyAccess, {}),
		client.query(api.access.queries.listMyCampaigns, {})
	]);

	// A stale cookie must not select a campaign the caller has since lost access
	// to, so it only counts when it appears in the list the server returned.
	const cookieId = cookies.get(ACTIVE_CAMPAIGN_COOKIE) ?? null;
	const activeCampaignId =
		cookieId && campaigns.some((c) => c._id === cookieId) ? cookieId : (campaigns[0]?._id ?? null);

	return { access, campaigns, activeCampaignId, sidebarOpen };
}) satisfies LayoutServerLoad;
