import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAccess } from '../model/access';
import { can } from '../../lib/domain/permissions';

/** The people who are part of a campaign, with their contact record joined in. */
export const listCampaignMembers = query({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return [];
		if (!can(access, 'contacts:read', args.campaignId)) return [];

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== access.orgId) return [];

		const links = await ctx.db
			.query('campaignMemberships')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.collect();

		return await Promise.all(
			links.map(async (link) => ({
				...link,
				contact: await ctx.db.get('contacts', link.contactId)
			}))
		);
	}
});

/** Campaigns a contact belongs to. */
export const listCampaignsForContact = query({
	args: { contactId: v.id('contacts') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return [];

		const links = await ctx.db
			.query('campaignMemberships')
			.withIndex('by_contactId', (q) => q.eq('contactId', args.contactId))
			.collect();

		const mine = links.filter((link) => link.orgId === access.orgId);
		return await Promise.all(
			mine.map(async (link) => ({
				...link,
				campaign: await ctx.db.get('campaigns', link.campaignId)
			}))
		);
	}
});
