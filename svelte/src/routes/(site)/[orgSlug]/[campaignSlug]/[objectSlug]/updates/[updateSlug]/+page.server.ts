import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import { renderRichText, richTextExcerpt } from '$lib/domain/rich-text';
import type { PageServerLoad } from './$types';

/** A `<meta name="description">` has a hard budget; 160 is the usual one. */
const DESCRIPTION_CHARS = 160;

/**
 * One campaign-level post at its own URL.
 *
 * A SLUG THAT RESOLVES TO NOTHING 404s, AND SO DOES ONE THAT IS NOT PUBLISHED —
 * identically, with the same status and the same body. That is the rule the
 * record page states for itself: a draft that answered differently from a
 * nonexistent slug would turn this route into an oracle for "is the org writing
 * about this yet", which is exactly the kind of thing a page about people
 * escaping forced labour must not tell a stranger. `getCampaignUpdate` returns
 * null for both cases and this load cannot tell them apart either.
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

	const update = await client.query(api.public.queries.getCampaignUpdate, {
		orgSlug: params.orgSlug,
		campaignSlug: params.campaignSlug,
		updateSlug: params.updateSlug
	});
	if (!update) error(404, 'Not found');

	return {
		campaign,
		// The FULL body, rendered here rather than in the browser — this is the
		// page "Read more" leads to, so there is nothing to truncate, but the
		// pipeline stays server-side for the reason every donor route states: it
		// is CDN-cached, and a markdown parser and sanitizer in the download is a
		// cost every stranger pays and a decision made on a machine we do not own.
		update: {
			title: update.title,
			slug: update.slug,
			publishedAt: update.publishedAt,
			html: renderRichText(update.body, update.assets),
			// Plain text from the same markdown, for the meta description. Parsed
			// rather than sliced, so a storage id or an embed URL cannot end up in
			// a search result.
			description: richTextExcerpt(update.body, DESCRIPTION_CHARS)
		},
		theme: campaign.theme ?? orgProfile.theme ?? 'jubilee'
	};
}) satisfies PageServerLoad;
