import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { getAccess, requireCapability } from '../model/access';

const imageKindValidator = v.union(v.literal('cover'), v.literal('icon'));
type ImageKind = 'cover' | 'icon';

// A pasted URL and an upload can never both claim a slot — same invariant as
// projects.photoUrl/photoStorageId. Keyed here so set/clear share one mapping
// instead of re-deriving it per handler.
const IMAGE_FIELDS: Record<
	ImageKind,
	{ storageField: 'coverImageStorageId' | 'iconStorageId'; urlField: 'coverImageUrl' | 'iconUrl' }
> = {
	cover: { storageField: 'coverImageStorageId', urlField: 'coverImageUrl' },
	icon: { storageField: 'iconStorageId', urlField: 'iconUrl' }
};

export const generateCampaignImageUploadUrl = mutation({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== access.orgId) {
			throw new ConvexError('Campaign not found');
		}
		await requireCapability(ctx, 'campaign:edit', campaign._id);
		return await ctx.storage.generateUploadUrl();
	}
});

/** Replaces the stored cover/icon image, deleting whatever blob it displaces. */
export const setCampaignImage = mutation({
	args: { campaignId: v.id('campaigns'), kind: imageKindValidator, storageId: v.id('_storage') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== access.orgId) {
			throw new ConvexError('Campaign not found');
		}
		await requireCapability(ctx, 'campaign:edit', campaign._id);

		const { storageField, urlField } = IMAGE_FIELDS[args.kind];
		const existingStorageId = campaign[storageField];
		if (existingStorageId && existingStorageId !== args.storageId) {
			await ctx.storage.delete(existingStorageId);
		}

		await ctx.db.patch('campaigns', args.campaignId, {
			[storageField]: args.storageId,
			// A pasted URL would otherwise still claim the slot alongside the upload.
			[urlField]: undefined
		} as Partial<Doc<'campaigns'>>);
		return args.campaignId;
	}
});

export const clearCampaignImage = mutation({
	args: { campaignId: v.id('campaigns'), kind: imageKindValidator },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== access.orgId) {
			throw new ConvexError('Campaign not found');
		}
		await requireCapability(ctx, 'campaign:edit', campaign._id);

		const { storageField, urlField } = IMAGE_FIELDS[args.kind];
		const existingStorageId = campaign[storageField];
		if (existingStorageId) {
			await ctx.storage.delete(existingStorageId);
		}

		await ctx.db.patch('campaigns', args.campaignId, {
			[storageField]: undefined,
			[urlField]: undefined
		} as Partial<Doc<'campaigns'>>);
		return null;
	}
});
