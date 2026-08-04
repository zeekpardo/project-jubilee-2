import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import { renderRichText } from '$lib/domain/rich-text';
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

	const [projects, stats, campaigns, updates] = await Promise.all([
		client.query(api.public.queries.listProjects, {
			orgSlug: params.orgSlug,
			campaignSlug: params.campaignSlug
		}),
		client.query(api.public.queries.getCampaignStats, {
			orgSlug: params.orgSlug,
			campaignSlug: params.campaignSlug
		}),
		client.query(api.public.queries.listCampaigns, { orgSlug: params.orgSlug }),
		client.query(api.public.queries.listCampaignUpdates, {
			orgSlug: params.orgSlug,
			campaignSlug: params.campaignSlug
		})
	]);

	return {
		campaign,
		projects,
		stats,
		// Markdown becomes HTML HERE, on the server, and the page ships only the
		// result. That is the entire reason an update stores markdown rather than
		// a document model: this route is served from a CDN under a five-minute
		// s-maxage, and rendering in the browser instead would put a parser — and
		// eventually an editor's worth of bytes — into a page every stranger who
		// visits has to download. `renderRichText` is also the sanitizer, so
		// doing it here keeps that decision on a machine the visitor does not own.
		// The query returns published rows only, so nothing needs filtering.
		updates: updates.map((update) => ({
			title: update.title,
			publishedAt: update.publishedAt,
			html: renderRichText(update.body, update.assets)
		})),
		// The org root only renders an index when there is a choice to make;
		// with one published campaign it redirects here, so a link up to it
		// would land the visitor back on this page.
		hasOrgIndex: campaigns.length > 1,
		theme: campaign.theme ?? orgProfile.theme ?? 'jubilee'
	};
}) satisfies PageServerLoad;
