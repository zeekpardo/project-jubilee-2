import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * The root is not a page. A signed-in person belongs in whichever surface is
 * theirs; anyone else belongs at sign-in. Redirecting here rather than
 * rendering an empty shell is what makes `/` usable as the address people
 * actually type.
 *
 * Everyone signed in is sent to `/app`, including a portal member, who is then
 * sent on to `/portal` by the app layout's own gate. One hop more than
 * necessary, and deliberately: which surface someone reaches is decided in one
 * place, by the load that has already resolved their access, rather than
 * restated here where it would need its own query and could disagree.
 */
export const load = (async ({ locals }) => {
	if (locals.token) redirect(307, '/app');
	redirect(307, '/signin');
}) satisfies PageServerLoad;
