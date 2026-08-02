import { query } from '../_generated/server';
import { getAccess } from '../model/access';
import { canAccessAdmin } from '../../lib/domain/permissions';

// This carries the org's campaign label and public profile, which the whole
// admin shell reads before any one capability is known, so it gates on "may
// this person reach the admin app at all" rather than on a specific
// capability — that would blank the shell for a team leader with no
// assignments yet.
export const getOrgSettings = query({
	args: {},
	handler: async (ctx) => {
		const access = await getAccess(ctx);
		if (!access.orgId || !canAccessAdmin(access)) {
			return null;
		}

		const orgId = access.orgId;
		return await ctx.db
			.query('orgSettings')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.unique();
	}
});
