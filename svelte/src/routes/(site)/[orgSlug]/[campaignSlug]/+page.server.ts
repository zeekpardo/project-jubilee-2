import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error, redirect } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import type { PageServerLoad } from './$types';

/**
 * The campaign has no landing page of its own: its records ARE what a visitor
 * came for, so this level only resolves the frozen objectSlug and forwards.
 *
 * The campaign is still fetched rather than the slug being pattern-matched,
 * because an unpublished campaign and a nonexistent one must 404 identically —
 * redirecting first would leak which slugs exist.
 */
export const load = (async ({ params }) => {
	const client = createConvexHttpClient();
	const campaign = await client.query(api.public.queries.getCampaign, {
		orgSlug: params.orgSlug,
		slug: params.campaignSlug
	});
	if (!campaign) error(404, 'Not found');

	// Temporary, like the org root's: objectSlug is frozen at creation today,
	// but a campaign becoming something other than a plain list of records
	// should not have to fight a permanently cached redirect.
	redirect(307, `/${params.orgSlug}/${campaign.slug}/${campaign.objectSlug}`);
}) satisfies PageServerLoad;
