import { ConvexError, v } from 'convex/values';
import { mutation, query } from '../_generated/server';
import { getAccess, requireCapability } from '../model/access';
import { can } from '../../lib/domain/permissions';

/**
 * Donations attributed to this record, newest first, with the giver's name and
 * the lifetime total. Only the donation portion of each allocation counts, so
 * a transaction split across several records contributes only its own share.
 */
export const listDonationsForProject = query({
	args: { projectId: v.id('projects') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) return { donations: [], totalCents: 0 };

		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== access.orgId) return { donations: [], totalCents: 0 };
		if (!can(access, 'money:read', project.campaignId)) return { donations: [], totalCents: 0 };

		const allocations = await ctx.db
			.query('allocations')
			.withIndex('by_projectId', (q) => q.eq('projectId', args.projectId))
			.collect();

		const donations = [];
		let totalCents = 0;

		for (const allocation of allocations) {
			const transaction = await ctx.db.get('transactions', allocation.transactionId);
			if (!transaction || transaction.type !== 'donation') continue;

			const contact = transaction.contactId
				? await ctx.db.get('contacts', transaction.contactId)
				: null;

			totalCents += allocation.amountCents;
			donations.push({
				allocationId: allocation._id,
				transactionId: transaction._id,
				// The share attributed here, not the whole transaction.
				amountCents: allocation.amountCents,
				transactionAmountCents: transaction.amountCents,
				occurredOn: transaction.occurredOn ?? null,
				method: transaction.method ?? null,
				reference: transaction.reference ?? null,
				budgetItem: allocation.budgetItem ?? null,
				contact
			});
		}

		return { donations, totalCents };
	}
});

export const generatePhotoUploadUrl = mutation({
	args: { projectId: v.id('projects') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== access.orgId) throw new ConvexError('Project not found');
		await requireCapability(ctx, 'projects:write', project.campaignId);
		return await ctx.storage.generateUploadUrl();
	}
});

/** Replaces the stored photo, deleting whatever blob it displaces. */
export const setProjectPhoto = mutation({
	args: { projectId: v.id('projects'), storageId: v.id('_storage') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== access.orgId) throw new ConvexError('Project not found');
		await requireCapability(ctx, 'projects:write', project.campaignId);

		if (project.photoStorageId && project.photoStorageId !== args.storageId) {
			await ctx.storage.delete(project.photoStorageId);
		}

		await ctx.db.patch('projects', args.projectId, {
			photoStorageId: args.storageId,
			// A pasted URL and an upload would otherwise both claim the hero.
			photoUrl: undefined
		});
		return args.projectId;
	}
});

export const clearProjectPhoto = mutation({
	args: { projectId: v.id('projects') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== access.orgId) throw new ConvexError('Project not found');
		await requireCapability(ctx, 'projects:write', project.campaignId);

		if (project.photoStorageId) await ctx.storage.delete(project.photoStorageId);
		await ctx.db.patch('projects', args.projectId, {
			photoStorageId: undefined,
			photoUrl: undefined
		});
		return null;
	}
});

/** The photo to show, resolving an upload to a URL. */
export const getProjectPhotoUrl = query({
	args: { projectId: v.id('projects') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		const project = await ctx.db.get('projects', args.projectId);
		if (!project || project.orgId !== access.orgId) return null;
		if (project.photoStorageId) return await ctx.storage.getUrl(project.photoStorageId);
		return project.photoUrl ?? null;
	}
});
