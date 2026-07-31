import { getContext, setContext } from 'svelte';
import type { AccessState } from './access.svelte';

const ACCESS_KEY = Symbol('access');

export function setAccessContext(access: AccessState): AccessState {
	return setContext(ACCESS_KEY, access);
}

/**
 * Read the access state established by the app layout. Throws rather than
 * returning a permissive default, so a component can never silently render as
 * though the caller had rights.
 */
export function getAccessContext(): AccessState {
	const access = getContext<AccessState | undefined>(ACCESS_KEY);
	if (!access) {
		throw new Error('getAccessContext() called outside of an <AccessProvider>');
	}
	return access;
}
