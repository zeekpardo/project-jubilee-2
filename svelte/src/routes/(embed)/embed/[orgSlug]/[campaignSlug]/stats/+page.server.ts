import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import type { PageServerLoad } from './$types';

/**
 * The impact-stats widget. Same 404 rule as every other (site)/(embed)
 * loader: an unpublished or nonexistent campaign 404s rather than rendering
 * an empty strip, since a host embedding a dead campaign slug should notice.
 */
export const load = (async ({ params, parent }) => {
	const { orgProfile } = await parent();
	const client = createConvexHttpClient();
	const campaign = await client.query(api.public.queries.getCampaign, {
		orgSlug: params.orgSlug,
		slug: params.campaignSlug
	});
	if (!campaign) error(404, 'Not found');

	const stats = await client.query(api.public.queries.getCampaignStats, {
		orgSlug: params.orgSlug,
		campaignSlug: params.campaignSlug
	});

	return {
		campaign,
		stats,
		theme: campaign.theme ?? orgProfile.theme ?? 'jubilee'
	};
}) satisfies PageServerLoad;
