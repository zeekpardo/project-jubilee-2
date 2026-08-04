// ============================================================
// Writing updates, and the separate decision to publish one
// ============================================================
// Every write here is gated twice, per model/access.ts: once org-wide to
// establish that the caller is staff at all, then again with the row's own
// `campaignId` once it has been read, because the campaign is only knowable
// after the load. `tasks/mutations.ts` is the worked example.
//
// The two gates are DIFFERENT CAPABILITIES on purpose:
//
//   create / edit / delete  — the parent's own capability, `projects:write` for
//                             a project update, `campaign:edit` for a campaign
//                             one. Writing a post is the same kind of work as
//                             writing the record's story.
//   publish / unpublish     — `content:publish`, which a team leader does not
//                             hold. The person who writes the post is not the
//                             person who decides it goes public. See
//                             model/updates.ts for why that split is the
//                             feature's real safety control.
//
// Nothing here ever publishes as a side effect. `createUpdate` always writes a
// draft, and `publishedAt` is passed IN rather than read from the clock, so a
// stored publish time can never quietly turn out to be a creation time.
// ============================================================

import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireCapability } from '../model/access';
import {
	deleteUpdateAssets,
	requireUpdate,
	requireUpdateParents,
	takenUpdateSlugs,
	updateWriteCapability
} from '../model/updates';
import { slugifyTitle, uniqueSlug } from '../../lib/domain/update-slug';

/** Titles and bodies are trimmed once, here, so no reader has to. */
function requireTitle(title: string): string {
	const trimmed = title.trim();
	if (!trimmed) throw new ConvexError('An update needs a title');
	return trimmed;
}

/**
 * The gate for editing an existing row: org-wide first, then the row's own
 * campaign with the capability its parent decides. The org-wide half asks
 * `projects:write`, the weakest staff capability, purely to establish the
 * caller — the campaign-scoped half below is what actually authorizes the
 * write, and it is never wider than this one.
 */
async function requireWritableUpdate(
	ctx: MutationCtx,
	updateId: Id<'updates'>
): Promise<{ update: Doc<'updates'>; orgId: string; userId: string }> {
	const { orgId } = await requireCapability(ctx, 'projects:write');
	const update = await requireUpdate(ctx, orgId, updateId);
	const { userId } = await requireCapability(
		ctx,
		updateWriteCapability(update.projectId),
		update.campaignId
	);
	return { update, orgId, userId };
}

/**
 * A new post, ALWAYS a draft. There is no create-and-publish argument, because
 * a single call that both writes prose and makes it public would put the
 * publish decision back in the hands of whoever wrote it.
 */
export const createUpdate = mutation({
	args: {
		campaignId: v.id('campaigns'),
		projectId: v.optional(v.id('projects')),
		title: v.string(),
		body: v.string(),
		assetIds: v.array(v.id('_storage'))
	},
	handler: async (ctx, args) => {
		const capability = updateWriteCapability(args.projectId);
		const { orgId, userId } = await requireCapability(ctx, capability, args.campaignId);
		await requireUpdateParents(ctx, orgId, args.campaignId, args.projectId);

		return await ctx.db.insert('updates', {
			orgId,
			campaignId: args.campaignId,
			projectId: args.projectId,
			title: requireTitle(args.title),
			body: args.body,
			assetIds: args.assetIds,
			status: 'draft' as const,
			authorUserId: userId
		});
	}
});

/**
 * Edit the prose or the pictures. The parents are deliberately absent: an
 * update belongs to the record it was written about, and never moves — the same
 * rule `documents` keeps for the project it was filed against.
 */
export const updateUpdate = mutation({
	args: {
		updateId: v.id('updates'),
		title: v.optional(v.string()),
		body: v.optional(v.string()),
		assetIds: v.optional(v.array(v.id('_storage')))
	},
	handler: async (ctx, args) => {
		const { update } = await requireWritableUpdate(ctx, args.updateId);

		const patch: Partial<Doc<'updates'>> = {};
		if (args.title !== undefined) patch.title = requireTitle(args.title);
		if (args.body !== undefined) patch.body = args.body;

		// Replacing the asset list drops the row's only reference to whatever fell
		// out of it, so those blobs have to go with it or they are leaked forever
		// — and a leaked blob is a live, un-revocable public URL, not just wasted
		// bytes. Same handling as replacing a document's file.
		let dropped: Doc<'updates'>['assetIds'] = [];
		if (args.assetIds !== undefined) {
			const kept = new Set<string>(args.assetIds);
			dropped = update.assetIds.filter((assetId) => !kept.has(assetId));
			patch.assetIds = args.assetIds;
		}

		await ctx.db.patch('updates', update._id, patch);
		await deleteUpdateAssets(ctx, dropped);
		return update._id;
	}
});

/**
 * Make a post public. `content:publish` only, and gated twice like every other
 * write here.
 *
 * `publishedAt` is an ARGUMENT. A query may not read the wall clock, so the
 * moment has to come from the caller; storing it explicitly is also what stops
 * the publish date from silently being the creation date, which is the mistake
 * that made the reference app's republishing invisible to a reader.
 *
 * This is also where the post acquires its public address. The slug is minted
 * ONLY when the row has none, so republishing after an unpublish keeps the
 * original one: a supporter who shared the link before it came down finds the
 * same post when it goes back up. Nothing recomputes it from the title either,
 * which is why fixing a typo in a headline later is a safe edit rather than a
 * silent link break.
 */
export const publishUpdate = mutation({
	args: {
		updateId: v.id('updates'),
		publishedAt: v.number()
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'content:publish');
		const update = await requireUpdate(ctx, orgId, args.updateId);
		await requireCapability(ctx, 'content:publish', update.campaignId);

		if (!Number.isFinite(args.publishedAt) || args.publishedAt <= 0) {
			throw new ConvexError('A publish time must be a moment in epoch milliseconds');
		}

		// A slug already on the row is left exactly as it is — see above. The
		// collision check is scoped to this update's own level, so a record's post
		// and its campaign's post may share a slug without either shadowing the
		// other; model/updates.ts holds that argument.
		let slug = update.slug;
		if (!slug) {
			const base = slugifyTitle(update.title);
			const taken = await takenUpdateSlugs(ctx, update.campaignId, update.projectId, base);
			slug = uniqueSlug(base, taken);
		}

		await ctx.db.patch('updates', update._id, {
			status: 'published' as const,
			publishedAt: args.publishedAt,
			slug
		});
		return update._id;
	}
});

/**
 * Take a post back off the public site. The same capability as publishing:
 * whoever may decide something goes out is who may decide it stops.
 *
 * `publishedAt` is cleared with it, so a draft never carries a publish time it
 * is not honouring, and republishing stamps a fresh one — the date a reader
 * sees is always the moment the text they are reading became public.
 *
 * The SLUG is deliberately not cleared with it. It is the post's identity, not
 * its publication state, and clearing it would hand the freed address to the
 * next post published in the same scope — so a link shared before this came
 * down would later open somebody else's story.
 *
 * Unpublishing does NOT revoke the photographs. Storage URLs handed out while
 * this was public do not expire; only deleting the blob does that, which is
 * `deleteUpdate` below.
 */
export const unpublishUpdate = mutation({
	args: { updateId: v.id('updates') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'content:publish');
		const update = await requireUpdate(ctx, orgId, args.updateId);
		await requireCapability(ctx, 'content:publish', update.campaignId);

		await ctx.db.patch('updates', update._id, {
			status: 'draft' as const,
			publishedAt: undefined
		});
		return update._id;
	}
});

/**
 * Delete a post and its photographs. The blobs go FIRST: once the row is gone
 * its `assetIds` are gone with it, and those ids are the only handle anything
 * has on the files. Deleting the blob is also the only way to revoke a storage
 * URL already in a stranger's hands.
 */
export const deleteUpdate = mutation({
	args: { updateId: v.id('updates') },
	handler: async (ctx, args) => {
		const { update } = await requireWritableUpdate(ctx, args.updateId);

		await deleteUpdateAssets(ctx, update.assetIds);
		await ctx.db.delete('updates', update._id);
		return null;
	}
});

/**
 * Mint an upload URL for a photograph destined for an update. Capability-gated
 * against the parent that will own it, never the bare minter in `storage.ts` —
 * that one asks only whether someone is signed in, which is not a question
 * about this campaign.
 *
 * No row exists yet to carry the ids, so the caller posts the bytes and then
 * passes the storage id to `createUpdate`/`updateUpdate`. A blob nothing ever
 * names is orphaned rather than leaked into a page.
 */
export const generateUpdateImageUploadUrl = mutation({
	args: {
		campaignId: v.id('campaigns'),
		projectId: v.optional(v.id('projects'))
	},
	handler: async (ctx, args) => {
		const capability = updateWriteCapability(args.projectId);
		const { orgId } = await requireCapability(ctx, capability, args.campaignId);
		await requireUpdateParents(ctx, orgId, args.campaignId, args.projectId);
		return await ctx.storage.generateUploadUrl();
	}
});
