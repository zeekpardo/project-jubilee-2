import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error, redirect } from '@sveltejs/kit';
import { building } from '$app/environment';
import { api } from '$convex/_generated/api';
import type { PageServerLoad } from './$types';

/**
 * What is left of `/portal` after the pages moved to `/{orgSlug}/me`: an
 * address that forwards, and nothing else. No component, because nothing here
 * is ever rendered on the way through.
 *
 * It is kept rather than deleted because `orgSettings.slug` is OPTIONAL. An org
 * that never claimed a public address has no `/{orgSlug}/me` for its members to
 * be sent to, and deleting this route would strand them at a 404 with no
 * successor. Keeping it also honours every bookmark and emailed link already
 * pointing here, and lets `/app`'s non-admin redirect keep naming one URL
 * instead of resolving a slug of its own.
 *
 * This is the ONE place in this phase that resolves the org from the SESSION's
 * active organization rather than from the URL. That is allowed only because
 * this URL carries no slug to disagree with: answering "where does this session
 * belong" is the whole job. Anything that holds an `orgSlug` must scope by it —
 * see `resolveSiteViewer` — and if this route ever gains one, this query stops
 * being the right source.
 */
export const load = (async ({ locals }) => {
	// No session means no org to resolve. Unreachable in a real request — the
	// auth hook sends a visitor without one to sign-in before this load runs —
	// so this only covers the build, where there is no request at all.
	if (building || !locals.token) error(404, 'Not found');

	const client = createConvexHttpClient({ token: locals.token });
	const orgSlug = await client.query(api.orgSettings.queries.getMyOrgSlug, {});

	// The org has never claimed a public address, so there is no page to forward
	// to and none to invent. A 404 is the honest answer and the one that cannot
	// loop: `/app` sends a non-admin here, so anything that sent them onward to
	// `/app` or to `/` would bounce them straight back. What they see is the
	// app's own not-found page, whose words — the page does not exist, or you
	// may not have access to it — are true in both directions, and true without
	// naming an org to a caller who may not belong to one.
	//
	// The fix is an admin claiming a site address in Settings, which is where
	// that copy already says it is required before any public page works.
	if (!orgSlug) error(404, 'Not found');

	redirect(307, `/${orgSlug}/me`);
}) satisfies PageServerLoad;
