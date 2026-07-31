import { getContext, setContext } from 'svelte';
import { browser } from '$app/environment';

export const SIDEBAR_COOKIE = 'sidebar_state';
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/** Below this the sidebar is a slide-over, so the icon rail does not apply. */
const DESKTOP_QUERY = '(min-width: 768px)';

/**
 * The cookie only ever holds `true` / `false`. Anything else — no cookie, a
 * value from an older build — means expanded, which is the friendlier default
 * for someone arriving for the first time.
 */
export function resolveSidebarOpen(value: unknown): boolean {
	return value !== 'false';
}

const SIDEBAR_KEY = Symbol('sidebar');

/**
 * Whether the desktop sidebar shows its full 16rem column or the 3rem icon
 * rail. The server reads the cookie and renders the right width in the first
 * byte of HTML, so there is no flash of the wrong state; from then on this
 * holds the live value.
 */
export function createSidebarState(getServerOpen: () => boolean) {
	let open = $state(getServerOpen());
	let mobile = $state(false);

	// The rail only exists on desktop, so the toggle has to know which layout
	// it is looking at.
	$effect(() => {
		const media = window.matchMedia(DESKTOP_QUERY);
		const sync = () => (mobile = !media.matches);
		sync();
		media.addEventListener('change', sync);
		return () => media.removeEventListener('change', sync);
	});

	function setOpen(value: boolean) {
		open = value;
		if (browser) {
			// Persisted so the next server render already knows the width.
			document.cookie = `${SIDEBAR_COOKIE}=${value}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax`;
		}
	}

	return {
		get open() {
			return open;
		},
		get collapsed() {
			return !open;
		},
		get isMobile() {
			return mobile;
		},
		setOpen,
		toggle() {
			setOpen(!open);
		}
	};
}

export type SidebarState = ReturnType<typeof createSidebarState>;

export function setSidebarContext(value: SidebarState): SidebarState {
	return setContext(SIDEBAR_KEY, value);
}

export function getSidebarContext(): SidebarState {
	const value = getContext<SidebarState | undefined>(SIDEBAR_KEY);
	if (!value) {
		throw new Error('getSidebarContext() called outside of the app layout');
	}
	return value;
}
