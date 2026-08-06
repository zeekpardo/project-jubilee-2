// ============================================================
// Reading a campaign's trip budget presets
// ============================================================
// ACCESS (§9). No trips capability exists: reads are `projects:read`, scoped to
// the campaign that owns the preset. A denied read returns `[]` rather than
// throwing — a query runs on every subscription tick, and a viewer who may not
// see this should watch the surface empty out, not fill with error dialogs.
// ============================================================

import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAccess } from '../model/access';
import { can } from '../../lib/domain/permissions';

/** Every preset this campaign keeps, newest first. */
export const listTripBudgetTemplates = query({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return [];
		if (!can(access, 'projects:read', args.campaignId)) return [];

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== access.orgId) return [];

		const templates = await ctx.db
			.query('tripBudgetTemplates')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.collect();

		// Newest first. Unversioned, so there is no ordering to read off the row
		// itself the way an append-only table gives for free.
		return templates.sort((a, b) => b._creationTime - a._creationTime);
	}
});
