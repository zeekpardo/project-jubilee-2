import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { requireCapability } from '../model/access';
import { createContactModel } from '../model/contacts';

async function requireCampaignInOrg(ctx: MutationCtx, orgId: string, campaignId: Id<'campaigns'>) {
	const campaign = await ctx.db.get('campaigns', campaignId);
	if (!campaign || campaign.orgId !== orgId) {
		throw new ConvexError('Campaign not found');
	}
	return campaign;
}

/** Add a contact that already exists to a campaign. */
export const addCampaignMember = mutation({
	args: {
		campaignId: v.id('campaigns'),
		contactId: v.id('contacts'),
		role: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'contacts:write', args.campaignId);
		await requireCampaignInOrg(ctx, orgId, args.campaignId);

		const contact = await ctx.db.get('contacts', args.contactId);
		if (!contact || contact.orgId !== orgId) {
			throw new ConvexError('Contact not found');
		}

		const role = args.role ?? 'attendee';
		const existing = await ctx.db
			.query('campaignMemberships')
			.withIndex('by_campaignId_and_contactId', (q) =>
				q.eq('campaignId', args.campaignId).eq('contactId', args.contactId)
			)
			.collect();
		if (existing.some((link) => link.role === role)) {
			throw new ConvexError('That person already has this role in the campaign');
		}

		return await ctx.db.insert('campaignMemberships', {
			orgId,
			campaignId: args.campaignId,
			contactId: args.contactId,
			role
		});
	}
});

/**
 * Create a person and put them in the campaign in one step, so adding
 * somebody new does not mean leaving the campaign to make a contact first.
 */
export const createCampaignMember = mutation({
	args: {
		campaignId: v.id('campaigns'),
		firstName: v.string(),
		lastName: v.optional(v.string()),
		email: v.optional(v.string()),
		phone: v.optional(v.string()),
		role: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'contacts:write', args.campaignId);
		await requireCampaignInOrg(ctx, orgId, args.campaignId);

		const contactId = await createContactModel(ctx, {
			orgId,
			firstName: args.firstName,
			lastName: args.lastName,
			email: args.email,
			phone: args.phone,
			source: 'campaign'
		});

		await ctx.db.insert('campaignMemberships', {
			orgId,
			campaignId: args.campaignId,
			contactId,
			role: args.role ?? 'attendee'
		});

		return contactId;
	}
});

export const updateCampaignMemberRole = mutation({
	args: { membershipId: v.id('campaignMemberships'), role: v.string() },
	handler: async (ctx, args) => {
		const membership = await ctx.db.get('campaignMemberships', args.membershipId);
		if (!membership) throw new ConvexError('Membership not found');

		const { orgId } = await requireCapability(ctx, 'contacts:write', membership.campaignId);
		if (membership.orgId !== orgId) throw new ConvexError('Membership not found');

		await ctx.db.patch('campaignMemberships', args.membershipId, { role: args.role });
		return args.membershipId;
	}
});

/** Removes the link only. The contact stays in the organization. */
export const removeCampaignMember = mutation({
	args: { membershipId: v.id('campaignMemberships') },
	handler: async (ctx, args) => {
		const membership = await ctx.db.get('campaignMemberships', args.membershipId);
		if (!membership) return null;

		const { orgId } = await requireCapability(ctx, 'contacts:write', membership.campaignId);
		if (membership.orgId !== orgId) throw new ConvexError('Membership not found');

		await ctx.db.delete('campaignMemberships', args.membershipId);
		return null;
	}
});
