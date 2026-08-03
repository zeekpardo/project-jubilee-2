import { getContext, setContext } from 'svelte';
import type { SiteViewerState } from './viewer.svelte';

const SITE_VIEWER_KEY = Symbol('site-viewer');

export function setSiteViewerContext(state: SiteViewerState): SiteViewerState {
	return setContext(SITE_VIEWER_KEY, state);
}

/**
 * Read the site viewer established by the `(site)` layout. Throws rather than
 * returning an anonymous default, so a component that ended up outside the
 * provider fails at the seam instead of quietly rendering the signed-out page
 * to someone who is signed in — a bug that looks exactly like working code.
 *
 * The `(embed)` group does not inherit the `(site)` layout, so this throwing
 * getter is also the thing that stops personalized chrome from being dropped
 * into an iframe on someone else's domain.
 */
export function getSiteViewerContext(): SiteViewerState {
	const state = getContext<SiteViewerState | undefined>(SITE_VIEWER_KEY);
	if (!state) {
		throw new Error('getSiteViewerContext() called outside of the (site) layout');
	}
	return state;
}
