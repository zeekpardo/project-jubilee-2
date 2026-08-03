import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { redirect, type Handle } from '@sveltejs/kit';
import { getSessionCookie } from 'better-auth/cookies';
import { createRouteMatcher } from '$lib/primitives/utils/routeMatcher';
import { getToken } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { withServerConvexToken } from '@mmailaender/convex-svelte/sveltekit/server';
import { paraglideMiddleware } from '$lib/i18n/paraglide/server.js';
import { MODE_COOKIE, THEME_COOKIE, modeClass, resolveMode, resolveTheme } from '$lib/theme/config';

/* --------------------------------------------------------- */
/* -------------------- route match helpers ---------------- */
/* --------------------------------------------------------- */

const isLogin = createRouteMatcher(['/signin']);
const isPublic = createRouteMatcher([
	'/',
	'/signin',
	'/reset-password',
	'/api/auth{/*rest}',
	'/pricing',
	'/docs{/*rest}',
	'/about',
	'/terms',
	'/privacy'
]);

/**
 * The public donor site (see src/routes/(site)). Its first segment is an
 * arbitrary org slug, so it cannot be allowlisted by literal path the way the
 * routes above are. Matching on the resolved route id rather than on the path
 * keeps this exact and fail-CLOSED: membership of the `(site)` group is the
 * whole test, so adding a public page needs no change here, and a new authed
 * top-level route can never be waved through by forgetting to reserve its
 * name. An unmatched path yields a null id and so still requires auth.
 */
const isPublicSite = (routeId: string | null): boolean => routeId?.startsWith('/(site)') ?? false;

/**
 * The embeddable widgets (see src/routes/(embed)). Same fail-closed matcher
 * shape as isPublicSite: membership of the `(embed)` group is the whole
 * test, matched on the resolved route id rather than a parsed path.
 */
const isEmbed = (routeId: string | null): boolean => routeId?.startsWith('/(embed)') ?? false;

/**
 * A person's own pages under `/{orgSlug}/me` (see src/routes/(me)).
 *
 * NOT public — this group is deliberately outside the two matchers above, and
 * that separation is the reason `(me)` is its own route group rather than a
 * folder inside `(site)`: the matchers wave a whole group through by prefix, so
 * an authenticated page living in `(site)` would be waved through with it.
 * What this is for is narrower — knowing that an unauthenticated visitor to one
 * of these URLs can be sent somewhere better than the platform sign-in page.
 */
const isOwnPages = (routeId: string | null): boolean => routeId?.startsWith('/(me)') ?? false;

/* --------------------------------------------------------- */
/* ---------------------- auth helpers --------------------- */
/* --------------------------------------------------------- */

/** Builds `/path?redirectTo=/original/path%3Fquery`  */
const withRedirect = (to: string, event: Parameters<Handle>[0]['event']) =>
	`${to}?redirectTo=${encodeURIComponent(event.url.pathname + event.url.search)}`;

/* --------------------------------------------------------- */
/* ---------------------- main handler --------------------- */
/* --------------------------------------------------------- */

const requireAuth: Handle = async ({ event, resolve }) => {
	// ⛑️ During build/prerender, skip all auth logic.
	// This prevents "Cannot access url.search on a page with prerendering enabled".
	if (building) {
		return resolve(event);
	}

	const { pathname } = event.url;
	const sessionCookie = getSessionCookie(event.request);

	/* ---------- 1. Handle public routes first ---------- */
	if (isPublic(pathname) || isPublicSite(event.route.id) || isEmbed(event.route.id)) {
		// Special case: redirect authenticated users away from signin
		if (isLogin(pathname) && sessionCookie) {
			throw redirect(307, '/');
		}
		return resolve(event);
	}

	/* ---------- 2. All other routes require authentication ---------- */
	if (!sessionCookie) {
		// Someone turned away from an org's own pages should sign in under that
		// org's name rather than the platform's. `/{orgSlug}/login` is the same
		// Better Auth flow wearing the charity's branding, and a donor who
		// followed a link from a campaign has no idea what this platform is
		// called — landing on its sign-in page reads like the wrong website.
		//
		// Falls back to `/signin` whenever the route did not name an org, which
		// covers `/app` and everything else. `withRedirect` carries the original
		// path either way, so the trip through sign-in is invisible.
		const orgSlug = isOwnPages(event.route.id) ? event.params.orgSlug : undefined;
		throw redirect(307, withRedirect(orgSlug ? `/${orgSlug}/login` : '/signin', event));
	}

	return resolve(event);
};

export const setTokenFromCookies: Handle = async ({ event, resolve }) => {
	// ⛑️ During build/prerender, skip all auth logic.
	// This prevents "BetterAuthError on a page with prerendering enabled".
	if (building) {
		return resolve(event);
	}

	const token = getToken(event.cookies);
	event.locals.token = token;

	return withServerConvexToken(token, () => resolve(event));
};

/* --------------------------------------------------------- */
/* ------------------ locale / theme shell ----------------- */
/* --------------------------------------------------------- */

/**
 * Resolves the locale (Paraglide: cookie → Accept-Language → baseLocale) and the
 * theme/mode cookies on the server, then stamps them onto <html> before the page
 * is streamed. This is what prevents a flash of the wrong language or palette:
 * the very first byte of HTML already carries the correct values.
 *
 * `system` mode renders no class — the OS preference is unknowable server-side,
 * so mode-watcher's blocking head script resolves it before the first paint.
 */
const setLocaleAndTheme: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		const theme = resolveTheme(building ? undefined : event.cookies.get(THEME_COOKIE));
		const mode = resolveMode(building ? undefined : event.cookies.get(MODE_COOKIE));

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', locale)
					.replace('%app.theme%', theme)
					.replace('%app.mode%', modeClass(mode))
		});
	});

/* --------------------------------------------------------- */
/* ------------------- framing policy ----------------------- */
/* --------------------------------------------------------- */

/**
 * Nothing set frame-ancestors or X-Frame-Options before this, which meant the
 * authenticated admin app at /app could be framed by any site. `/(embed)`
 * routes exist specifically to be framed by an org's own site, and serve
 * nothing that isn't already public through src/convex/public/queries.ts —
 * so they get an explicit allow. Everything else is denied, including a new
 * top-level route added later: the check is fail-closed the same way
 * isPublicSite/isEmbed are, keyed off event.route.id rather than a
 * hand-parsed path.
 */
const setFrameAncestors: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// Only documents can be framed, so only documents carry the policy. That is
	// not merely an optimisation: /api/auth/* is proxied from better-auth and
	// returns a Response whose headers are IMMUTABLE, so setting a header on
	// every response throws `TypeError: immutable` and turns sign-in into a 500.
	const isDocument = response.headers.get('content-type')?.includes('text/html') ?? false;
	if (!isDocument) return response;

	if (isEmbed(event.route.id)) {
		response.headers.set('Content-Security-Policy', 'frame-ancestors *');
	} else {
		response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
		// Belt-and-braces for browsers that don't honor CSP's frame-ancestors;
		// DENY is the only value here since ALLOW-FROM is deprecated/removed —
		// which is exactly why the embed branch above cannot use this header.
		response.headers.set('X-Frame-Options', 'DENY');
	}

	return response;
};

/* --------------------------------------------------------- */
/* ---------------------- exported hook -------------------- */
/* --------------------------------------------------------- */

export const handle = sequence(
	/* 1 */ requireAuth,
	/* 2 */ setTokenFromCookies,
	/* 3 */ setLocaleAndTheme,
	/* 4 */ setFrameAncestors
);
export type { Handle };
