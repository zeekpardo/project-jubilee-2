import { redirect } from '@sveltejs/kit';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { api } from '$convex/_generated/api';
import type { PageServerLoad } from './$types';

/** Org existence is already validated by the (site) layout above this. */
export const load = (async ({ params }) => {
	const client = createConvexHttpClient();
	const campaigns = await client.query(api.public.queries.listCampaigns, {
		orgSlug: params.orgSlug
	});

	// An org with one published campaign has nothing to choose between, so the
	// index would be a page with a single link on it. Send visitors straight to
	// the records — that is what they came for. TEMPORARY on purpose: publishing
	// a second campaign makes this index meaningful again, and a permanent
	// redirect would already be cached in every browser that ever saw it.
	if (campaigns.length === 1) {
		const [campaign] = campaigns;
		redirect(307, `/${params.orgSlug}/${campaign.slug}/${campaign.objectSlug}`);
	}

	return { campaigns };
}) satisfies PageServerLoad;
