import { ConvexError } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { authComponent, createAuth } from '../auth';

/**
 * The caller's active organization, or null. Queries use this so an
 * unauthenticated read returns empty rather than throwing.
 */
export async function activeOrgId(ctx: QueryCtx): Promise<string | null> {
	const user = await authComponent.safeGetAuthUser(ctx);
	if (!user) {
		return null;
	}

	try {
		const auth = createAuth(ctx);
		const organization = await auth.api.getFullOrganization({
			headers: await authComponent.getHeaders(ctx)
		});
		return organization?.id ?? null;
	} catch {
		return null;
	}
}

/** The caller's active organization. Mutations use this so writes fail loudly. */
export async function requireOrgId(ctx: MutationCtx): Promise<string> {
	const user = await authComponent.safeGetAuthUser(ctx);
	if (!user) {
		throw new ConvexError('Not authenticated');
	}

	const auth = createAuth(ctx);
	const organization = await auth.api.getFullOrganization({
		headers: await authComponent.getHeaders(ctx)
	});
	if (!organization) {
		throw new ConvexError('No active organization');
	}

	return organization.id;
}
