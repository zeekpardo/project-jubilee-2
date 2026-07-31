import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * The root is not a page. A signed-in admin belongs in the app; anyone else
 * belongs at sign-in. Redirecting here rather than rendering an empty shell is
 * what makes `/` usable as the address people actually type.
 */
export const load = (async ({ locals }) => {
	if (locals.token) redirect(307, '/app');
	redirect(307, '/signin');
}) satisfies PageServerLoad;
