import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error } from '@sveltejs/kit';
import { api } from '$convex/_generated/api';
import { richTextExcerpt } from '$lib/domain/rich-text';
import type { PageServerLoad } from './$types';

/** A sentence or two under each title — long enough to place a post, not read it. */
const EXCERPT_CHARS = 200;

/**
 * The wall's own ceiling, asked for explicitly. Left unset the query returns 50,
 * and an archive that stops early without saying so hides the oldest posts —
 * which on a record page are the ones a returning supporter came back for.
 *
 * A record past 100 posts needs the `publishedBefore` keyset cursor the query
 * takes, and a control to drive it. That page does not exist yet; this is the
 * honest limit until it does, not a page size.
 */
const ARCHIVE_LIMIT = 100;

/**
 * Everything this campaign has published about one record, newest first.
 *
 * An unpublished record and a nonexistent one both come back null from
 * getProject, so both 404 identically — the record page's own rule, kept here
 * because this route is another way to ask the same question. `listProjectUpdates`
 * would have returned an empty list for either, which would have rendered as
 * "no updates yet" and quietly confirmed the record exists.
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

	// Fetched together for the reason the record page gives: both take the same
	// slug and number, so waiting for the record first would only add a round
	// trip. Asking for both is safe because listProjectUpdates repeats the
	// record's own publish check itself.
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
			limit: ARCHIVE_LIMIT
		})
	]);
	if (!project) error(404, 'Not found');

	return {
		campaign,
		project,
		// Plain text, not HTML. Rendering every body to read a list of titles
		// would cost a donor on a phone an article per line; the permalink is
		// where a body gets rendered. `richTextExcerpt` parses the markdown rather
		// than slicing the source, so a storage id or an embed URL never surfaces.
		updates: updates.map((update) => ({
			title: update.title,
			slug: update.slug,
			publishedAt: update.publishedAt,
			excerpt: richTextExcerpt(update.body, EXCERPT_CHARS)
		})),
		theme: campaign.theme ?? orgProfile.theme ?? 'jubilee'
	};
}) satisfies PageServerLoad;
