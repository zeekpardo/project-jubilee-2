// Loading an org's public policy from its settings row.
//
// Its own module for the same reason model/fields.ts is: the wall
// (model/public.ts), the stat engine (model/stats.ts) and the write-time
// checks all need it, and none of them should have to import another.

import type { MutationCtx, QueryCtx } from '../_generated/server';
import { resolvePublicPolicy, type PublicPolicy } from '../../lib/domain/public-policy';

/**
 * The org's policy, or the shipped defaults when it has no settings row.
 *
 * Fails STRICT, not open: an org we know nothing about gets the full denylist
 * and the default count floor, because the cost of guessing wrong is a leak.
 */
export async function loadPublicPolicy(
	ctx: QueryCtx | MutationCtx,
	orgId: string
): Promise<PublicPolicy> {
	const settings = await ctx.db
		.query('orgSettings')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.unique();
	return resolvePublicPolicy(settings);
}
