import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import { renderRichText } from '$lib/domain/rich-text';
import type { PageServerLoad } from './$types';

/**
 * An unpublished project and a nonexistent one both come back null from
 * getProject, so both 404 identically — same rule as the campaign lookup,
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

	// Fetched together rather than one after the other: the updates query takes
	// the same slug and number the record does, so waiting for the record first
	// would only add a round trip to a page a donor is waiting on. Asking for
	// both is safe because listProjectUpdates repeats the record's own publish
	// check itself and returns nothing for a record this page would 404 anyway.
	const [project, updates] = await Promise.all([
		client.query(api.public.queries.getProject, {
			orgSlug: params.orgSlug,
			campaignSlug: params.campaignSlug,
			number: params.number
		}),
		client.query(api.public.queries.listProjectUpdates, {
			orgSlug: params.orgSlug,
			campaignSlug: params.campaignSlug,
			number: params.number
		})
	]);
	if (!project) error(404, 'Not found');

	return {
		campaign,
		project,
		// Rendered on the server for the reason the grid page states at length:
		// this route is CDN-cached, and the markdown parser and sanitizer belong
		// on our machine, not in the download every visitor pays for.
		updates: updates.map((update) => ({
			title: update.title,
			publishedAt: update.publishedAt,
			html: renderRichText(update.body, update.assets)
		})),
		theme: campaign.theme ?? orgProfile.theme ?? 'jubilee'
	};
}) satisfies PageServerLoad;
