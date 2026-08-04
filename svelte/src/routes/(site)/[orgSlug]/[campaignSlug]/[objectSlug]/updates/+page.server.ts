import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import { richTextExcerpt } from '$lib/domain/rich-text';
import type { PageServerLoad } from './$types';

/** A sentence or two under each title — long enough to place a post, not read it. */
const EXCERPT_CHARS = 200;

/**
 * The wall's own ceiling, asked for explicitly. Left unset the query returns 50,
 * and an archive that stops early without saying so hides exactly the posts a
 * supporter deciding whether to trust this org goes looking for — the old ones.
 *
 * A campaign past 100 posts needs the `publishedBefore` keyset cursor the query
 * takes, and a control to drive it. That is a page this brief did not ask for;
 * until it exists the number here is the honest limit, not a page size.
 */
const ARCHIVE_LIMIT = 100;

/**
 * The campaign's blog: every post it has published at campaign level, newest
 * first. The grid page shows four; this is the archive behind them.
 *
 * The campaign checks are the grid page's, verbatim, because this route hangs
 * off the same three segments: an unknown or unpublished campaign 404s, and a
 * stale objectSlug 404s rather than redirecting to the live one.
 *
 * NOTE ON THIS ROUTE'S NAME. `updates` is a static segment sitting beside the
 * dynamic `[number]`, and SvelteKit resolves static segments first, so a record
 * whose number is literally "updates" is unreachable — the same reservation
 * `login` and `me` already carry on this site. Not fixed here; there is a task
 * open for reserved record numbers.
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

	const updates = await client.query(api.public.queries.listCampaignUpdates, {
		orgSlug: params.orgSlug,
		campaignSlug: params.campaignSlug,
		limit: ARCHIVE_LIMIT
	});

	return {
		campaign,
		// Plain text, not HTML. An index of thirty posts rendering thirty bodies
		// would make a donor download thirty articles to read thirty titles; the
		// permalink is where a body gets rendered. `richTextExcerpt` parses the
		// markdown properly rather than slicing the source, so a storage id or an
		// embed URL never surfaces as an excerpt.
		updates: updates.map((update) => ({
			title: update.title,
			slug: update.slug,
			publishedAt: update.publishedAt,
			excerpt: richTextExcerpt(update.body, EXCERPT_CHARS)
		})),
		theme: campaign.theme ?? orgProfile.theme ?? 'jubilee'
	};
}) satisfies PageServerLoad;
