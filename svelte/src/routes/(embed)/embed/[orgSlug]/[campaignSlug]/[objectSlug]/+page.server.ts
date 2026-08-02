import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import type { PageServerLoad } from './$types';

/**
 * objectSlug is frozen at campaign creation, same rule as the (site) grid: a
 * mismatch here means a stale or hand-typed embed src, so it 404s the same
 * as an unknown campaign rather than redirecting to the live slug.
 */
export const load = (async ({ params, parent }) => {
	const { orgProfile } = await parent();
	const client = createConvexHttpClient();
	const campaign = await client.query(api.public.queries.getCampaign, {
		orgSlug: params.orgSlug,
		slug: params.campaignSlug
	});
	if (!campaign) error(404, 'Not found');
	if (params.objectSlug !== campaign.objectSlug) error(404, 'Not found');

	const projects = await client.query(api.public.queries.listProjects, {
		orgSlug: params.orgSlug,
		campaignSlug: params.campaignSlug
	});

	return {
		campaign,
		projects,
		theme: campaign.theme ?? orgProfile.theme ?? 'jubilee'
	};
}) satisfies PageServerLoad;
