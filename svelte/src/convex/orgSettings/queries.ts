import { query } from '../_generated/server';
import { authComponent, createAuth } from '../auth';

export const getOrgSettings = query({
	args: {},
	handler: async (ctx) => {
		const user = await authComponent.safeGetAuthUser(ctx);
		if (!user) {
			return null;
		}

		const auth = createAuth(ctx);
		const organization = await auth.api
			.getFullOrganization({ headers: await authComponent.getHeaders(ctx) })
			.catch(() => null);
		if (!organization) {
			return null;
		}

		const orgId = organization.id;
		return await ctx.db
			.query('orgSettings')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.unique();
	}
});
