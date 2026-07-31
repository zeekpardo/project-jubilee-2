import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAccess } from '../model/access';
import { can } from '../../lib/domain/permissions';
import type { Doc, Id } from '../_generated/dataModel';

/**
 * Everyone connected to a campaign, from BOTH directions: people explicitly
 * added to it, and people on one of its records. Someone put on a record is
 * plainly part of that campaign, so deriving the second source here avoids
 * asking anyone to add them twice and keeps the two from drifting apart.
 *
 * A row with no `membershipId` exists only through a record; its role cannot
 * be edited here because there is no membership to edit.
 */
export const listCampaignMembers = query({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return [];
		if (!can(access, 'contacts:read', args.campaignId)) return [];

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== access.orgId) return [];

		type Row = {
			contactId: Id<'contacts'>;
			contact: Doc<'contacts'> | null;
			membershipId: Id<'campaignMemberships'> | null;
			role: string | null;
			viaProjects: { number: string; name: string; role: string }[];
		};

		const byContact = new Map<string, Row>();

		const memberships = await ctx.db
			.query('campaignMemberships')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.collect();

		for (const membership of memberships) {
			byContact.set(membership.contactId as string, {
				contactId: membership.contactId,
				contact: await ctx.db.get('contacts', membership.contactId),
				membershipId: membership._id,
				role: membership.role,
				viaProjects: []
			});
		}

		const projects = await ctx.db
			.query('projects')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.collect();

		for (const project of projects) {
			const links = await ctx.db
				.query('projectMembers')
				.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
				.collect();

			for (const link of links) {
				const key = link.contactId as string;
				const existing = byContact.get(key);
				const via = { number: project.number, name: project.name, role: link.role };
				if (existing) {
					existing.viaProjects.push(via);
					continue;
				}
				byContact.set(key, {
					contactId: link.contactId,
					contact: await ctx.db.get('contacts', link.contactId),
					membershipId: null,
					role: null,
					viaProjects: [via]
				});
			}
		}

		return [...byContact.values()];
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
