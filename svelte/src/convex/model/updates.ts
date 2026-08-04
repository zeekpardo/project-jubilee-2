// ============================================================
// Updates: who may write one, and who may publish it
// ============================================================
// An update is a post about what happened — free prose and photographs about a
// named family — so two different questions are asked about every write here,
// and they have different answers.
//
//   WRITING rides the parent's existing capability. A project update is work on
//   a record, so it is `projects:write`, exactly like the project's own story
//   and photo. A campaign update is work on the campaign, so it is
//   `campaign:edit`. Nothing new is granted to anybody by an update existing.
//
//   PUBLISHING is `content:publish`, which a team leader does not hold. See
//   TEAM_LEADER_DENIED in lib/domain/permissions.ts for the whole argument: a
//   denylist can police custom fields because fields have keys, and a paragraph
//   has none, so the only control left is that the person who writes the post
//   is not the person who decides it goes out.
//
// BLOBS. `assetIds` is the only handle to an update's photographs — a storage
// id named only from inside the markdown body is invisible to model/cascade.ts,
// which keys off columns. Every path that drops one of those ids has to delete
// the blob with it, because deleting the blob is the ONLY way to revoke a
// storage URL that has already been handed to a visitor. There is no expiry.
// ============================================================

import { ConvexError } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { Capability } from '../../lib/domain/permissions';

/** The most rows any one read of this table may return. */
const UPDATE_PAGE_MAX = 100;

export const clampUpdateLimit = (limit: number | undefined): number =>
	Math.max(1, Math.min(Math.floor(limit ?? 50), UPDATE_PAGE_MAX));

/**
 * The capability that authorizes WRITING an update with this parent. Taken from
 * whether it names a project, not from the caller's role, so an update is
 * always governed by the thing it is about.
 */
export function updateWriteCapability(projectId: Id<'projects'> | undefined): Capability {
	return projectId ? 'projects:write' : 'campaign:edit';
}

/** An update in the caller's org, or a hard failure. */
export async function requireUpdate(
	ctx: MutationCtx,
	orgId: string,
	updateId: Id<'updates'>
): Promise<Doc<'updates'>> {
	const update = await ctx.db.get('updates', updateId);
	if (!update || update.orgId !== orgId) {
		throw new ConvexError('Update not found');
	}
	return update;
}

/**
 * The campaign an update names, and the project when it names one — both
 * checked against the caller's org, and the project checked against the
 * campaign. `campaignId` is carried on a project update too, so a mismatch here
 * is the one thing that could put a post in the wrong campaign's feed.
 */
export async function requireUpdateParents(
	ctx: MutationCtx,
	orgId: string,
	campaignId: Id<'campaigns'>,
	projectId: Id<'projects'> | undefined
): Promise<{ campaign: Doc<'campaigns'>; project: Doc<'projects'> | null }> {
	const campaign = await ctx.db.get('campaigns', campaignId);
	if (!campaign || campaign.orgId !== orgId) {
		throw new ConvexError('Campaign not found');
	}
	if (!projectId) return { campaign, project: null };

	const project = await ctx.db.get('projects', projectId);
	if (!project || project.orgId !== orgId) {
		throw new ConvexError('Project not found');
	}
	if (project.campaignId !== campaignId) {
		throw new ConvexError('That record belongs to a different campaign');
	}
	return { campaign, project };
}

/**
 * Delete blobs an update no longer references. Convex storage has no cascade,
 * and a URL already handed out can only be revoked by deleting what it points
 * at, so this runs on every path that drops an id — replacing the asset list,
 * deleting the row, and both cascades.
 */
export async function deleteUpdateAssets(
	ctx: MutationCtx,
	assetIds: Id<'_storage'>[]
): Promise<void> {
	for (const assetId of assetIds) {
		await ctx.storage.delete(assetId);
	}
}

/**
 * Storage ids resolved to the URLs a renderer substitutes into the body. An id
 * that no longer resolves is DROPPED rather than thrown on, the same way
 * `resolveReceiptUrl` degrades: a deleted photo should cost a figure, not the
 * whole post.
 *
 * This resolves the address of a photograph. It does not decide to show one —
 * the caller does that, and on the public side the wall re-checks the publish
 * status before it ever gets here.
 */
export async function resolveUpdateAssets(
	ctx: QueryCtx,
	assetIds: Id<'_storage'>[]
): Promise<Record<string, string>> {
	const assets: Record<string, string> = {};
	for (const assetId of assetIds) {
		const url = await ctx.storage.getUrl(assetId);
		if (url) assets[assetId] = url;
	}
	return assets;
}

/**
 * An admin list: the campaign's or record's drafts first, newest first, then
 * its published posts, newest first.
 *
 * Two reads rather than one because `status` is the first key after the parent
 * in both indexes, so a single ordered read cannot interleave the two — and
 * whichever status sorted second would be the one a `.take()` truncated away.
 * Drafts lead because they are what an author came to the page for.
 */
export async function listUpdatesByParent(
	ctx: QueryCtx,
	parent:
		| { campaignId: Id<'campaigns'>; campaignLevelOnly: boolean }
		| { projectId: Id<'projects'> },
	limit: number
): Promise<Doc<'updates'>[]> {
	const read = async (status: 'draft' | 'published') => {
		if ('projectId' in parent) {
			const projectId = parent.projectId;
			return await ctx.db
				.query('updates')
				.withIndex('by_projectId_and_status_and_publishedAt', (q) =>
					q.eq('projectId', projectId).eq('status', status)
				)
				.order('desc')
				.take(limit);
		}
		const campaignId = parent.campaignId;
		const query = ctx.db
			.query('updates')
			.withIndex('by_campaignId_and_status_and_publishedAt', (q) =>
				q.eq('campaignId', campaignId).eq('status', status)
			)
			.order('desc');
		// Campaign-level means projectId ABSENT. No index can express that
		// alongside the campaign, so it is a filter — applied before the take, so
		// the page is still `limit` rows of the thing that was asked for.
		return await (
			parent.campaignLevelOnly ? query.filter((q) => q.eq(q.field('projectId'), undefined)) : query
		).take(limit);
	};

	return [...(await read('draft')), ...(await read('published'))];
}
