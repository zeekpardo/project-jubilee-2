import { getContext, setContext } from 'svelte';
import { page } from '$app/state';

const CRUMB_TITLE_KEY = Symbol('crumbTitle');

/** Trailing slashes are a URL detail, not part of a crumb's identity. */
function normalize(pathname: string): string {
	return pathname.replace(/\/+$/, '') || '/';
}

/**
 * A record's own name for the last breadcrumb. The trail is derived from the
 * path, which can only ever read an id segment back as itself, so a detail
 * page hands the name over here once it has loaded it. The pathname is stored
 * alongside the label so one page's title can never show up on another.
 */
export function createCrumbTitle() {
	let entry = $state<{ pathname: string; label: string } | null>(null);

	return {
		labelFor(pathname: string): string | null {
			const key = normalize(pathname);
			return entry?.pathname === key ? entry.label : null;
		},
		set(pathname: string, label: string) {
			entry = { pathname: normalize(pathname), label };
		},
		clear(pathname: string) {
			if (entry?.pathname === normalize(pathname)) entry = null;
		}
	};
}

export type CrumbTitle = ReturnType<typeof createCrumbTitle>;

export function setCrumbTitleContext(value: CrumbTitle): void {
	setContext(CRUMB_TITLE_KEY, value);
}

export function getCrumbTitleContext(): CrumbTitle {
	return getContext<CrumbTitle>(CRUMB_TITLE_KEY);
}

/**
 * Names the current page's last crumb. Call during component init; the title
 * is dropped again on navigation, so a slow-loading record falls back to the
 * id rather than leaving the previous record's name in the trail.
 */
export function useCrumbTitle(label: () => string | null | undefined): void {
	const crumb = getCrumbTitleContext();

	$effect(() => {
		const pathname = page.url.pathname;
		const value = label();
		if (!value) return;

		crumb.set(pathname, value);
		return () => crumb.clear(pathname);
	});
}
