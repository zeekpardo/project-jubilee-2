// API
import { useQuery } from '@mmailaender/convex-svelte';
import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
import { getAuthContext } from '$lib/auth/context.svelte';

/**
 * The viewer's own name, and nothing else — the same two strings
 * `toSiteGreeting` returns in `src/convex/model/site.ts`.
 *
 * There is deliberately no contact id here, and none may be added. This value
 * lives in a browser that a stranger may be sitting at one navigation later,
 * and an id in the browser is an argument waiting to be accepted by the next
 * mutation that takes one "because the client already has it".
 */
export type SiteGreeting = { firstName: string; displayName: string };

export type SiteViewerState = {
	readonly isLoading: boolean;
	/** Null is the anonymous answer, and it is the answer for every failure too. */
	readonly viewer: SiteGreeting | null;
	/** The org this viewer was resolved against, so a caller can key on it. */
	readonly orgSlug: string;
};

/**
 * Who is looking at this org's public site, if anyone.
 *
 * BROWSER ONLY, and that is the whole design. The `(site)` layout load sets
 * `cache-control: public, s-maxage=300`, so its HTML is shared by every visitor
 * a CDN serves it to; a personalized byte in that response is one donor's
 * identity handed to the next stranger who asks for the page. Nothing here runs
 * during SSR — `useQuery` subscribes after hydration — which is why the
 * signed-in chrome appears a moment late instead of never appearing wrong.
 *
 * `orgSlug` arrives as a getter because the answer is scoped to the org whose
 * page is on screen: the same signed-in person is a stranger on another org's
 * site, and a client-side navigation between the two has to re-ask rather than
 * keep greeting them.
 */
export function useSiteViewer(getOrgSlug: () => string): SiteViewerState {
	// `api` comes through the auth context rather than a direct import, the same
	// as everywhere else in this app, so a component never reaches past the
	// provider for its backend handle.
	const { api } = getAuthContext();
	const auth = useAuth();

	const orgSlug = $derived(getOrgSlug());

	// Skipping while signed out is not an optimization. Most visitors to a
	// donation page have no session at all, and asking the backend who they are
	// on every public page load would be a subscription per anonymous reader for
	// an answer that is already known to be null.
	const response = useQuery(api.site.queries.getSiteViewer, () =>
		auth.isAuthenticated ? { orgSlug } : 'skip'
	);

	return {
		/**
		 * True only while the answer is genuinely unknown: the session handshake
		 * is still in flight, or the query is subscribed and has not replied. A
		 * signed-out visitor settles on false, because "nobody" is an answer.
		 */
		get isLoading() {
			return auth.isLoading || response.isLoading;
		},
		/**
		 * Loading, skipped, and FAILED all collapse to anonymous. A personalization
		 * query that threw its way onto the screen would take a working donation
		 * page down with it, so a broken greeting can only ever cost the greeting.
		 */
		get viewer() {
			if (response.error) return null;
			return response.data ?? null;
		},
		get orgSlug() {
			return orgSlug;
		}
	};
}
