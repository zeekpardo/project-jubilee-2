import {
	createConvexHttpClient,
	getAuthState
} from '@mmailaender/convex-better-auth-svelte/sveltekit';
import type { LayoutServerLoad } from './$types';
import { api } from '$convex/_generated/api';
import { AUTH_CONSTANTS } from '$convex/auth.constants';
import { building } from '$app/environment';
import { MODE_COOKIE, THEME_COOKIE, resolveMode, resolveTheme } from '$lib/theme/config';
import { getLocale } from '$lib/i18n';
import { isTransportFailure } from '$lib/primitives/utils/transportFailure';

export const load = (async ({ locals, cookies }) => {
	// During build/prerender, skip auth state fetching (BETTER_AUTH_SECRET not available)
	if (building) {
		return {
			authState: { isAuthenticated: false },
			initialData: undefined,
			theme: resolveTheme(undefined),
			mode: resolveMode(undefined),
			locale: getLocale()
		};
	}

	// Mirrors the cookies read in `hooks.server.ts` so the client store starts on the
	// same values the server already rendered into <html>.
	const theme = resolveTheme(cookies.get(THEME_COOKIE));
	const mode = resolveMode(cookies.get(MODE_COOKIE));
	const locale = getLocale();

	const authState = getAuthState();
	const token = locals.token;
	if (!token) return { authState, initialData: undefined, theme, mode, locale };
	const client = createConvexHttpClient({ token });

	const orgs = AUTH_CONSTANTS.organizations;

	// `initialData` is only a hydration hint — every reader treats it as optional
	// and the client re-queries anyway. `authState`, theme, mode and locale all
	// come from cookies, so none of them need Convex. That makes a prefetch that
	// never reached Convex safe to drop: the shell still renders and the client's
	// own reactive queries fill it in. What is *not* safe to drop is Convex
	// answering and rejecting — an expired token has to keep failing loudly
	// rather than leave the user in a shell that never recovers.
	try {
		const [
			activeUser,
			accountList,
			activeOrganization,
			organizationList,
			invitationList,
			roleResult
		] = await Promise.all([
			client.query(api.users.queries.getActiveUser),
			client.query(api.users.queries.listAccounts),
			orgs
				? client.query(api.organizations.queries.getActiveOrganization)
				: Promise.resolve(undefined),
			orgs ? client.query(api.organizations.queries.listOrganizations) : Promise.resolve(undefined),
			orgs
				? client.query(api.organizations.invitations.queries.listInvitations)
				: Promise.resolve(undefined),
			orgs
				? client.query(api.organizations.queries.getOrganizationRole, {})
				: Promise.resolve(undefined)
		]);

		return {
			authState,
			initialData: {
				activeUser,
				accountList,
				activeOrganization,
				organizationList,
				invitationList,
				role: roleResult ?? undefined
			},
			theme,
			mode,
			locale
		};
	} catch (error) {
		if (!isTransportFailure(error)) throw error;
		// Logged, not swallowed: a real outage still has to be visible in the
		// server log rather than disappearing into a silently emptier shell.
		console.error('Convex prefetch unreachable, rendering without initialData:', error);
		return { authState, initialData: undefined, theme, mode, locale };
	}
}) satisfies LayoutServerLoad;
