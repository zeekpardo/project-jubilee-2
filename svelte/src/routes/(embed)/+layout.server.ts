import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import type { LayoutServerLoad } from './$types';

/**
 * The embeddable widgets (see src/routes/(embed)). Same anonymous, wall-only
 * data source as the (site) group's layout — createConvexHttpClient() takes
 * no token, deliberately, and every read goes through
 * src/convex/public/queries.ts.
 *
 * This layout file sits directly above the (embed) group, so SvelteKit's
 * generated types can't prove orgSlug is present at this exact scope — only
 * `embed/[orgSlug]` and its descendants ever reach it in practice. An
 * unknown org slug 404s here so no descendant page has to re-check it. A
 * campaign-scoped descendant overrides `theme` with
 * `campaign.theme ?? orgProfile.theme ?? 'jubilee'`; this is only the
 * org-index default.
 */
export const load = (async ({ params, setHeaders }) => {
	const orgSlug = params.orgSlug;
	if (!orgSlug) error(404, 'Not found');

	const client = createConvexHttpClient();
	const orgProfile = await client.query(api.public.queries.getOrgProfile, { orgSlug });
	if (!orgProfile) error(404, 'Not found');

	// Shareable and cacheable, not real-time — same tolerance as the (site) group.
	setHeaders({ 'cache-control': 'public, max-age=60, s-maxage=300' });

	return {
		orgProfile,
		theme: orgProfile.theme ?? 'jubilee'
	};
}) satisfies LayoutServerLoad;
