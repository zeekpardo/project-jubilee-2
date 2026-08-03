import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { api } from '$convex/_generated/api';
import { building } from '$app/environment';
import { canAccessAdmin } from '$lib/domain/permissions';
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

	// Deliberately unguarded, unlike the root layout. There the prefetch is only a
	// hydration hint the client re-fetches; here `campaigns` has no client-side
	// query behind it, so degrading to the empty state would strand the user in a
	// campaign-less "access denied" shell that never heals. Letting this throw is
	// the better failure: the root layout has already resolved by now, so the
	// error page renders inside a working shell with the real cause on it.
	const [access, campaigns] = await Promise.all([
		client.query(api.access.queries.getMyAccess, {}),
		client.query(api.access.queries.listMyCampaigns, {})
	]);

	// Decided here as well as in the layout's `{#if}`, because a portal member
	// is the first role that can hold a session and reach this load. The client
	// guard renders a refusal; this one never renders the shell at all, and
	// sends them to the surface they do have.
	//
	// Still `/portal` now that those pages live at `/{orgSlug}/me`, and
	// deliberately: `/portal` is a redirector that resolves the caller's own org
	// slug, and it is the only thing that can answer honestly when the org never
	// claimed one. Naming the destination directly from here would mean
	// resolving the slug a second time and re-deciding the slug-less case, in a
	// load that exists to keep non-staff out of the admin shell.
	if (!canAccessAdmin(access)) redirect(307, '/portal');

	// A stale cookie must not select a campaign the caller has since lost access
	// to, so it only counts when it appears in the list the server returned.
	const cookieId = cookies.get(ACTIVE_CAMPAIGN_COOKIE) ?? null;
	const activeCampaignId =
		cookieId && campaigns.some((c) => c._id === cookieId) ? cookieId : (campaigns[0]?._id ?? null);

	return { access, campaigns, activeCampaignId, sidebarOpen };
}) satisfies LayoutServerLoad;
