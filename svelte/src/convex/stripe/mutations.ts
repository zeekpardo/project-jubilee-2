import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import { requireCapability } from '../model/access';

/**
 * The org's identity as it appears on a tax acknowledgment.
 *
 * Gated on `billing:manage` — owner-only — rather than riding along on
 * `upsertOrgSettings`, which any holder of `settings:manage` can call. These
 * three fields are what make a receipt legally substantiating: an EIN typed in
 * by someone who should not have been near it produces documents that assert
 * something false to the IRS on the nonprofit's behalf. That is a narrower
 * audience than "can edit org settings".
 *
 * Deliberately does NOT validate the EIN's format beyond shape. A nine-digit
 * check would reject valid identifiers from orgs that are not US 501(c)(3)s,
 * and this app should not be the thing that decides who counts as a charity.
 */
export const updateReceiptDetails = mutation({
	args: {
		legalName: v.optional(v.string()),
		ein: v.optional(v.string()),
		acknowledgmentText: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'billing:manage');

		const settings = await ctx.db
			.query('orgSettings')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.unique();
		if (!settings) {
			throw new ConvexError('This organization has no settings row yet');
		}

		await ctx.db.patch('orgSettings', settings._id, {
			legalName: args.legalName?.trim() || undefined,
			ein: args.ein?.trim() || undefined,
			acknowledgmentText: args.acknowledgmentText?.trim() || undefined
		});
		return null;
	}
});
