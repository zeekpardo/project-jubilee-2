import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import type { LayoutServerLoad } from './$types';

/**
 * The public donor site. Every load under this group is anonymous —
 * createConvexHttpClient() takes no token, deliberately — and reads only
 * through the privacy wall in src/convex/public/queries.ts.
 *
 * An unknown org slug 404s here so no descendant page has to re-check it. A
 * campaign-scoped descendant overrides `theme` with
 * `campaign.theme ?? orgProfile.theme ?? 'jubilee'`; this is only the
 * org-index default.
 */
export const load = (async ({ params, setHeaders }) => {
	// This layout file sits directly above the (site) group, so SvelteKit's
	// generated types can't prove orgSlug is present at this exact scope —
	// only [orgSlug] and its descendants ever reach it in practice.
	const orgSlug = params.orgSlug;
	if (!orgSlug) error(404, 'Not found');

	const client = createConvexHttpClient();
	const orgProfile = await client.query(api.public.queries.getOrgProfile, { orgSlug });
	if (!orgProfile) error(404, 'Not found');

	// Shareable and SEO-critical, not real-time — donor pages tolerate
	// staleness measured in minutes.
	setHeaders({ 'cache-control': 'public, max-age=60, s-maxage=300' });

	return {
		orgProfile,
		theme: orgProfile.theme ?? 'jubilee'
	};
}) satisfies LayoutServerLoad;
