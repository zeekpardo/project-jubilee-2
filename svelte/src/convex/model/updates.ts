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
// ADDRESSING. A published post is reachable at a URL, and ids do not travel
// (PLAN-updates.md §4c), so the handle is a slug frozen at first publish. Its
// uniqueness scope is the level it belongs to, never the campaign as a whole:
// see `takenUpdateSlugs` below for why that distinction is load-bearing rather
// than tidy.
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
 * The most sibling slugs one collision check will read. The scan below is
 * narrowed to a single base's own family of slugs, so reaching this cap would
 * mean two hundred posts in one campaign whose titles all reduce to the same
 * words — far past anything real, which is what makes the cap safe to have.
 */
const SLUG_FAMILY_MAX = 200;

/**
 * The slugs a new one must not collide with, and NO others.
 *
 * The scope is the level, not the campaign. A project update is unique among
 * that project's posts; a campaign-level update is unique among that campaign's
 * campaign-level posts. Both levels are expressed by the same range because
 * `projectId` is an equality component of the index — passing `undefined` names
 * the campaign level, passing an id names one record. That is also what keeps
 * the two levels from addressing each other: every row carries `campaignId`, so
 * a (campaignId, slug) key alone would let a campaign-wide post answer to a
 * record's URL, publishing org-wide news at a named family's address.
 *
 * Only the candidate's own family is read — `base` itself plus every `base-N` —
 * rather than all of the parent's posts. A bounded scan of everything would
 * silently stop being a uniqueness check once a campaign outgrew the cap, and
 * the duplicate it then minted would make one of the two permalinks
 * unreachable, which is a broken shared link and not a visible error.
 */
export async function takenUpdateSlugs(
	ctx: QueryCtx,
	campaignId: Id<'campaigns'>,
	projectId: Id<'projects'> | undefined,
	base: string
): Promise<Set<string>> {
	// Every candidate is `base` or `base-N`. '-' is 0x2D, so '.' at 0x2E is the
	// first string that sorts after all of them: the range is exactly this base's
	// family and nothing beyond it.
	const familyEnd = `${base}.`;

	const siblings = await ctx.db
		.query('updates')
		.withIndex('by_campaignId_and_projectId_and_slug', (q) =>
			q
				.eq('campaignId', campaignId)
				.eq('projectId', projectId)
				.gte('slug', base)
				.lt('slug', familyEnd)
		)
		.take(SLUG_FAMILY_MAX);

	return new Set(siblings.map((sibling) => sibling.slug).filter((slug): slug is string => !!slug));
}

/**
 * One update at a public address, or null. The level is pinned by the same
 * `projectId` equality as above, so a campaign-level slug cannot be resolved
 * from a record's URL and a record's slug cannot be resolved from the
 * campaign's — the wrong level is not a wrong answer here, it is a post about a
 * named family surfacing somewhere nobody chose to put it.
 *
 * `.first()` rather than `.unique()`: slug uniqueness is enforced at publish
 * time, and a visitor should not be the one who discovers it was broken.
 * Returns the row unscrubbed — every caller must still take it through
 * `toPublicUpdate`, which is where the publish decision is enforced.
 */
export async function updateBySlug(
	ctx: QueryCtx,
	campaignId: Id<'campaigns'>,
	projectId: Id<'projects'> | undefined,
	slug: string
): Promise<Doc<'updates'> | null> {
	return await ctx.db
		.query('updates')
		.withIndex('by_campaignId_and_projectId_and_slug', (q) =>
			q.eq('campaignId', campaignId).eq('projectId', projectId).eq('slug', slug)
		)
		.first();
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
		// Campaign-level means projectId ABSENT, which IS expressible alongside the
		// campaign: an index carrying `projectId` matches a missing field against
		// `undefined`. Worth the second index rather than a post-index filter,
		// because a filtered page can come back short of `limit` while more rows
		// remain, and an author would read that as "there are no more".
		if (parent.campaignLevelOnly) {
			return await ctx.db
				.query('updates')
				.withIndex('by_campaignId_and_projectId_and_status_and_publishedAt', (q) =>
					q.eq('campaignId', campaignId).eq('projectId', undefined).eq('status', status)
				)
				.order('desc')
				.take(limit);
		}
		return await ctx.db
			.query('updates')
			.withIndex('by_campaignId_and_status_and_publishedAt', (q) =>
				q.eq('campaignId', campaignId).eq('status', status)
			)
			.order('desc')
			.take(limit);
	};

	return [...(await read('draft')), ...(await read('published'))];
}
