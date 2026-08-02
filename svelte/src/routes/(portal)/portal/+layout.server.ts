import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { redirect } from '@sveltejs/kit';
import { building } from '$app/environment';
import { api } from '$convex/_generated/api';
import { canAccessAdmin } from '$lib/domain/permissions';
import type { LayoutServerLoad } from './$types';

/**
 * The portal, gated ON THE SERVER.
 *
 * `/app` guards with a client-side `{#if}` and relies on its queries to be the
 * real protection. That is defensible there — every one of those queries now
 * names the capability it needs — but it is not a pattern to copy, so this
 * group decides before it renders anything.
 *
 * Authentication itself is already settled by `hooks.server.ts`: an unmatched
 * route id requires a session, and `(portal)` is not in any public allowlist.
 * What arrives here is a signed-in person who may or may not be a portal
 * member.
 *
 * The claim runs first and on every load, not at sign-in. Someone arriving
 * from a magic link has a session and an accepted invitation but no link
 * between their account and their contact row yet, and the link needs an
 * ACTIVE ORGANIZATION to scope the lookup — which only exists once the
 * invitation is accepted. It is a compare-and-set on an unlinked contact, so
 * every load after the first finds the work already done.
 */
export const load = (async ({ locals }) => {
	if (building || !locals.token) return { overview: null, situation: null };

	const client = createConvexHttpClient({ token: locals.token });

	await client.mutation(api.portal.mutations.claimPortalAccess, {});
	const overview = await client.query(api.portal.queries.getPortalOverview, {});

	// No portal identity. Staff are sent to the app they do have — the surface
	// is a property of the route, not of the person, and a staff member who has
	// never been invited as a contact simply has no portal of their own. Anyone
	// else sees the group's own refusal page rather than a redirect loop.
	if (!overview) {
		const access = await client.query(api.access.queries.getMyAccess, {});
		if (canAccessAdmin(access)) redirect(307, '/app');

		// Fetched only on the way to the refusal page, so the ordinary load stays
		// two round trips. What it costs is paid by the person who is stuck.
		const situation = await client.query(api.portal.queries.getPortalSituation, {});
		return { overview: null, situation };
	}

	return { overview, situation: null };
}) satisfies LayoutServerLoad;
