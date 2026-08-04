import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import { renderRichText, richTextExcerpt } from '$lib/domain/rich-text';
import type { PageServerLoad } from './$types';

/** A `<meta name="description">` has a hard budget; 160 is the usual one. */
const DESCRIPTION_CHARS = 160;

/**
 * One post about one record, at its own URL. This is the riskiest page this
 * feature adds — free prose an org wrote about a named family, addressable by a
 * stranger who guessed a URL — so every "not for you" answer is the same answer.
 *
 * A NONEXISTENT SLUG, A DRAFT, AN UNPUBLISHED RECORD AND AN UNPUBLISHED CAMPAIGN
 * ALL 404 IDENTICALLY. That is the record page's rule, restated because this
 * route is a second way to ask the same question: if a draft answered
 * differently from a nonexistent slug, the difference would tell someone the org
 * is writing about this family, which is the disclosure itself. The wall makes
 * that easy to honour — `getProjectUpdate` returns null in every one of those
 * cases and this load cannot tell them apart.
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

	// One round trip for both, same as the record page: the record is needed for
	// the links back, and the post is needed for the page. `getProjectUpdate`
	// repeats the record's own publish check, so asking for both at once cannot
	// return a post for a record this page would 404 anyway.
	const [project, update] = await Promise.all([
		client.query(api.public.queries.getProject, {
			orgSlug: params.orgSlug,
			campaignSlug: params.campaignSlug,
			number: params.number
		}),
		client.query(api.public.queries.getProjectUpdate, {
			orgSlug: params.orgSlug,
			campaignSlug: params.campaignSlug,
			number: params.number,
			updateSlug: params.updateSlug
		})
	]);
	if (!project) error(404, 'Not found');
	if (!update) error(404, 'Not found');

	return {
		campaign,
		project,
		// The FULL body — this is where "Read more" was going — rendered on the
		// server like every other donor route: CDN-cached page, parser and
		// sanitizer on our machine, no editor bytes in anyone's download.
		update: {
			title: update.title,
			slug: update.slug,
			publishedAt: update.publishedAt,
			html: renderRichText(update.body, update.assets),
			// Plain text from the same markdown for the meta description, parsed
			// rather than sliced so no storage id reaches a search result.
			description: richTextExcerpt(update.body, DESCRIPTION_CHARS)
		},
		theme: campaign.theme ?? orgProfile.theme ?? 'jubilee'
	};
}) satisfies PageServerLoad;
