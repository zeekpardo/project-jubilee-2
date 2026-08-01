import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import type { PageServerLoad } from './$types';

/**
 * objectSlug is frozen at campaign creation so a label rename can't break a
 * shared URL — a mismatch here means a stale or hand-typed link, so it 404s
 * the same as an unknown campaign rather than redirecting to the live slug.
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

	const [projects, stats, campaigns] = await Promise.all([
		client.query(api.public.queries.listProjects, {
			orgSlug: params.orgSlug,
			campaignSlug: params.campaignSlug
		}),
		client.query(api.public.queries.getCampaignStats, {
			orgSlug: params.orgSlug,
			campaignSlug: params.campaignSlug
		}),
		client.query(api.public.queries.listCampaigns, { orgSlug: params.orgSlug })
	]);

	return {
		campaign,
		projects,
		stats,
		// The org root only renders an index when there is a choice to make;
		// with one published campaign it redirects here, so a link up to it
		// would land the visitor back on this page.
		hasOrgIndex: campaigns.length > 1,
		theme: campaign.theme ?? orgProfile.theme ?? 'jubilee'
	};
}) satisfies PageServerLoad;
