import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import type { PageServerLoad } from './$types';

/**
 * Same 404 rules as the (site) detail loader: an unpublished or nonexistent
 * project both come back null from getProject, so both 404 identically —
 * no enumeration oracle. objectSlug is checked before even querying the
 * project, same as the grid page.
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

	const project = await client.query(api.public.queries.getProject, {
		orgSlug: params.orgSlug,
		campaignSlug: params.campaignSlug,
		number: params.number
	});
	if (!project) error(404, 'Not found');

	return {
		campaign,
		project,
		theme: campaign.theme ?? orgProfile.theme ?? 'jubilee'
	};
}) satisfies PageServerLoad;
