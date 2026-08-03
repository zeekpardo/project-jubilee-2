import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { error, redirect } from '@sveltejs/kit';
import { building } from '$app/environment';
import { api } from '$convex/_generated/api';
import type { LayoutServerLoad } from './$types';

/**
 * A person's own pages at one org's public address, gated ON THE SERVER.
 *
 * `/app` guards with a client-side `{#if}` and relies on its queries to be the
 * real protection. That is defensible there — every one of those queries now
 * names the capability it needs — but it is not a pattern to copy, so this
 * group decides before it renders anything.
 *
 * Authentication itself is already settled by `hooks.server.ts`: an unmatched
 * route id requires a session, and `(me)` is deliberately its own group rather
 * than a folder inside `(site)`, because that hook waves through anything whose
 * route id starts with `/(site)`. Putting these pages in that group would wave
 * them through too. What arrives here is therefore a signed-in person who may
 * or may not have a record with THIS org.
 *
 * The claim runs first and on every load, not at sign-in. Someone arriving
 * from a magic link has a session and an accepted invitation but no link
 * between their account and their contact row yet, and the link needs an
 * ACTIVE ORGANIZATION to scope the lookup — which only exists once the
 * invitation is accepted. It is a compare-and-set on an unlinked contact, so
 * every load after the first finds the work already done.
 */
export const load = (async ({ params, locals, setHeaders }) => {
	const orgSlug = params.orgSlug;

	// Set before anything can throw, so every response this load produces
	// carries it. These pages are one person's giving history and address; a
	// shared cache holding any of it would hand it to the next reader of the
	// same URL. The public `(site)` layout sets `public, s-maxage=300` on its
	// own responses, and this group exists partly so that header can never
	// reach a personal page.
	setHeaders({ 'cache-control': 'private, no-store' });

	// `(me)` does not inherit `(site)/+layout.server.ts`, so the org profile is
	// loaded here rather than found on the parent. Anonymous client on purpose:
	// this is the same chrome, read through the same privacy wall, as the public
	// page next door. An unknown slug 404s exactly as it does there, so the two
	// halves of one address cannot disagree about whether the org exists.
	const publicClient = createConvexHttpClient();
	const orgProfile = await publicClient.query(api.public.queries.getOrgProfile, { orgSlug });
	if (!orgProfile) error(404, 'Not found');

	const theme = orgProfile.theme ?? 'jubilee';

	// Only reachable while building, where there is no request and so no
	// session. A real visitor without one never gets this far — the auth hook
	// sent them to sign-in before this load ran.
	if (building || !locals.token) return { orgProfile, theme, overview: null };

	const client = createConvexHttpClient({ token: locals.token });

	await client.mutation(api.portal.mutations.claimPortalAccess, { orgSlug });
	const overview = await client.query(api.portal.queries.getPortalOverview, { orgSlug });

	// No record with THIS org, so there is nothing here that belongs to them and
	// no page to show. They are bounced to the org's public front page rather
	// than told why: this URL is public and guessable, so a page that explained
	// itself would answer "does this org know this email" for anyone who signed
	// in and tried. The old single-tenant `/portal` could afford that page —
	// you only reached it from an invitation — and this address cannot.
	//
	// This also replaces the old redirect that sent staff to `/app`. Its reason
	// was that the surface is a property of the route rather than of the person,
	// which still holds; what changed is that it is no longer a special case.
	// A staff member with no contact row at this org has no record here either,
	// and leaves the same way everybody else does.
	if (!overview) redirect(307, `/${orgSlug}`);

	return { orgProfile, theme, overview };
}) satisfies LayoutServerLoad;
