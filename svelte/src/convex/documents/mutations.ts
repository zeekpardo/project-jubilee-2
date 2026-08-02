import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireCapability } from '../model/access';
import { assertAmountCents, assertStage, requireDocumentProject } from '../model/documents';

async function requireDocument(
	ctx: MutationCtx,
	orgId: string,
	documentId: Id<'documents'>
): Promise<Doc<'documents'>> {
	const document = await ctx.db.get('documents', documentId);
	if (!document || document.orgId !== orgId) {
		throw new ConvexError('Document not found');
	}
	return document;
}

const kindValidator = v.union(
	v.literal('debt_evidence'),
	v.literal('receipt'),
	v.literal('legal_certificate'),
	v.literal('photo'),
	v.literal('agreement'),
	v.literal('other')
);

export const generateUploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		// No row exists yet to carry a campaignId, so this gates org-wide.
		await requireCapability(ctx, 'projects:write');
		return await ctx.storage.generateUploadUrl();
	}
});

export const createDocument = mutation({
	args: {
		projectId: v.id('projects'),
		stage: v.string(),
		kind: kindValidator,
		url: v.optional(v.string()),
		storageId: v.optional(v.id('_storage')),
		notes: v.optional(v.string()),
		confirmedBy: v.optional(v.string()),
		company: v.optional(v.string()),
		amountCents: v.optional(v.number()),
		occurredOn: v.optional(v.string()),
		budgetItem: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const project = await requireDocumentProject(ctx, orgId, args.projectId);
		await requireCapability(ctx, 'projects:write', project.campaignId);
		await assertStage(ctx, project, args.stage);
		assertAmountCents(args.amountCents);

		return await ctx.db.insert('documents', { ...args, orgId });
	}
});

// projectId is deliberately absent — a document is evidence for the project it
// was filed against, and never moves.
export const updateDocument = mutation({
	args: {
		documentId: v.id('documents'),
		stage: v.optional(v.string()),
		kind: v.optional(kindValidator),
		url: v.optional(v.string()),
		storageId: v.optional(v.id('_storage')),
		notes: v.optional(v.string()),
		confirmedBy: v.optional(v.string()),
		company: v.optional(v.string()),
		amountCents: v.optional(v.number()),
		occurredOn: v.optional(v.string()),
		budgetItem: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const document = await requireDocument(ctx, orgId, args.documentId);
		// The campaign lives on the document's project, so it has to be loaded
		// here rather than only when the stage changes.
		const project = await requireDocumentProject(ctx, orgId, document.projectId);
		await requireCapability(ctx, 'projects:write', project.campaignId);

		const { documentId, ...updates } = args;

		if (updates.stage !== undefined && updates.stage !== document.stage) {
			await assertStage(ctx, project, updates.stage);
		}
		assertAmountCents(updates.amountCents);

		const patch: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(updates)) {
			if (value !== undefined) {
				patch[key] = value;
			}
		}

		// Replacing the file drops the row's only reference to the old blob, so
		// the old blob has to go with it or it is leaked forever.
		const replacedStorageId =
			updates.storageId !== undefined &&
			document.storageId !== undefined &&
			updates.storageId !== document.storageId
				? document.storageId
				: null;

		await ctx.db.patch('documents', documentId, patch as Partial<Doc<'documents'>>);
		if (replacedStorageId !== null) {
			await ctx.storage.delete(replacedStorageId);
		}
		return documentId;
	}
});

export const deleteDocument = mutation({
	args: {
		documentId: v.id('documents')
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const document = await requireDocument(ctx, orgId, args.documentId);
		const project = await requireDocumentProject(ctx, orgId, document.projectId);
		await requireCapability(ctx, 'projects:write', project.campaignId);

		// Convex storage has no cascade: the blob outlives the row unless it is
		// deleted here.
		if (document.storageId !== undefined) {
			await ctx.storage.delete(document.storageId);
		}

		await ctx.db.delete('documents', args.documentId);
		return null;
	}
});
