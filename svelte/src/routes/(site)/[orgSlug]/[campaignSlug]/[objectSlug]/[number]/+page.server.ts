import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import { renderRichText } from '$lib/domain/rich-text';
import { truncateMarkdown } from '$lib/domain/update-excerpt';
import type { PageServerLoad } from './$types';

/**
 * One lead post plus three headlines is the whole teaser, so this is all the
 * record page ever needs. Asked of the query rather than sliced afterwards: the
 * default page is larger, and every row beyond these four would be a body
 * fetched and resolved for assets only to be discarded here.
 */
const FEED_SIZE = 4;

/**
 * Blocks of the lead kept on the record page. Enough that a returning supporter
 * gets the substance of the news without the page becoming the news.
 */
const LEAD_BLOCKS = 3;

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
			number: params.number,
			limit: FEED_SIZE
		})
	]);
	if (!project) error(404, 'Not found');

	const [lead, ...headlines] = updates;
	const leadExcerpt = lead ? truncateMarkdown(lead.body, LEAD_BLOCKS) : null;

	return {
		campaign,
		project,
		// Rendered on the server for the reason the grid page states at length:
		// this route is CDN-cached, and the markdown parser and sanitizer belong
		// on our machine, not in the download every visitor pays for.
		//
		// And CUT before it is rendered, which is the other half of the same
		// argument. A `line-clamp` on the full body would hide the rest of a long
		// post from the reader while still shipping every word of it to them, and
		// to the CDN, and to anyone who opens the page source. The blocks
		// `truncateMarkdown` drops here are never rendered and never serialized.
		updates: {
			lead:
				lead && leadExcerpt
					? {
							title: lead.title,
							slug: lead.slug,
							publishedAt: lead.publishedAt,
							html: renderRichText(leadExcerpt.markdown, lead.assets),
							// The page cannot tell from rendered HTML whether there
							// was more, so it is told.
							truncated: leadExcerpt.truncated
						}
					: null,
			headlines: headlines.map((update) => ({
				title: update.title,
				slug: update.slug,
				publishedAt: update.publishedAt
			}))
		},
		theme: campaign.theme ?? orgProfile.theme ?? 'jubilee'
	};
}) satisfies PageServerLoad;
