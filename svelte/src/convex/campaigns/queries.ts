import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { readableOrgId } from '../model/access';
import { computeStats, evaluateStats, type EvaluatedStat, type ResolvedStat } from '../model/stats';
import { resolveContactFieldDefs } from '../model/fields';
import { loadPublicPolicy } from '../model/policy';
import { HOUSEHOLD_ROLES, isPersonReachedRole } from '../../lib/domain/campaign-stats';
import { isProtectedFieldKey } from '../../lib/domain/field-definitions';

/**
 * An uploaded cover/icon is reachable only through a signed URL, so a
 * storage id is resolved to one here. A pasted `coverImageUrl`/`iconUrl` is
 * already a URL and passes through untouched; it is also the fallback if
 * signing ever fails. Mirrors `projects/queries.ts`'s `withPhotoUrls`.
 */
async function withImageUrls(ctx: QueryCtx, row: Doc<'campaigns'>): Promise<Doc<'campaigns'>> {
	let next = row;
	if (row.coverImageStorageId) {
		const url = await ctx.storage.getUrl(row.coverImageStorageId);
		if (url) next = { ...next, coverImageUrl: url };
	}
	if (row.iconStorageId) {
		const url = await ctx.storage.getUrl(row.iconStorageId);
		if (url) next = { ...next, iconUrl: url };
	}
	return next;
}

export const listCampaigns = query({
	args: {},
	handler: async (ctx) => {
		// There is no standalone campaign-read capability — a campaign is the
		// shell around a projects/pipeline workspace, so projects:read is what
		// gates seeing it at all.
		const orgId = await readableOrgId(ctx, 'projects:read');
		if (!orgId) {
			return [];
		}

		const rows = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.collect();
		return await Promise.all(rows.map((row) => withImageUrls(ctx, row)));
	}
});

export const getCampaign = query({
	args: {
		campaignId: v.id('campaigns')
	},
	handler: async (ctx, args) => {
		// Gated twice: once org-wide so a caller with no read access anywhere is
		// turned away before the row is even loaded, then again scoped to the
		// loaded campaign's own id, since args.campaignId cannot be trusted to
		// name a campaign in the caller's org until it is loaded and checked.
		const orgId = await readableOrgId(ctx, 'projects:read');
		if (!orgId) {
			return null;
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return null;
		}

		const scopedOrgId = await readableOrgId(ctx, 'projects:read', campaign._id);
		if (!scopedOrgId) {
			return null;
		}

		return await withImageUrls(ctx, campaign);
	}
});

/**
 * The values a member stat can actually filter on, read from this campaign's
 * own data rather than guessed at.
 *
 * A picker built from a fixed list would offer relationships nobody uses and
 * miss the ones a campaign invented. `householdRoles` is the schema's enum, so
 * it is complete by construction; `relationships` is free text and only what
 * has been recorded exists.
 */
export const listMemberDimensions = query({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'projects:read', args.campaignId);
		if (!orgId) {
			return { householdRoles: [], relationships: [], contactFields: [] };
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return { householdRoles: [], relationships: [], contactFields: [] };
		}

		const projects = await ctx.db
			.query('projects')
			.withIndex('by_campaignId', (q) => q.eq('campaignId', args.campaignId))
			.collect();

		const relationships = new Set<string>();
		const householdRoles = new Set<string>();
		for (const project of projects) {
			const links = await ctx.db
				.query('projectMembers')
				.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
				.collect();
			for (const link of links) {
				if (!isPersonReachedRole(link.role)) continue;
				const relationship = link.attributes?.relationship;
				if (typeof relationship === 'string' && relationship.trim()) {
					relationships.add(relationship.trim());
				}
				const householdLinks = await ctx.db
					.query('householdMembers')
					.withIndex('by_contactId', (q) => q.eq('contactId', link.contactId))
					.collect();
				for (const householdLink of householdLinks) householdRoles.add(householdLink.role);
			}
		}

		const contactDefs = await resolveContactFieldDefs(ctx, orgId, args.campaignId);
		const policy = await loadPublicPolicy(ctx, orgId);

		return {
			// The enum is the full set; sorting the ones in use to the front would
			// only make the list jump about as data changes.
			householdRoles: HOUSEHOLD_ROLES.filter((role) => householdRoles.has(role)),
			relationships: [...relationships].sort((a, b) => a.localeCompare(b)),
			contactFields: contactDefs
				// Refused at write time anyway; not offering it is the friendlier gate.
				.filter((def) => !isProtectedFieldKey(def.key, policy.extraProtectedKeys))
				.map((def) => ({
					key: def.key,
					label: def.label,
					isPublic: def.isPublic,
					options: def.options ?? []
				}))
		};
	}
});

/**
 * Every configured stat with its current number AND whether the public site
 * would actually show it. This is what lets the stat editor warn an admin
 * ("this would be hidden — fewer than five records") instead of leaving them to
 * discover a stat silently missing from their own site.
 *
 * Admin-only: it deliberately reports the un-suppressed internal figure and the
 * reason a stat is withheld, neither of which may cross the public wall.
 */
export const previewStats = query({
	args: { campaignId: v.id('campaigns') },
	handler: async (ctx, args): Promise<EvaluatedStat[]> => {
		const orgId = await readableOrgId(ctx, 'projects:read', args.campaignId);
		if (!orgId) {
			return [];
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return [];
		}

		return await evaluateStats(ctx, campaign);
	}
});

/**
 * The campaign's INTERNAL stat strip: the same configured list the public site
 * renders, filtered to `showOnDashboard` instead. This is the only surface
 * where a tagged-but-private stat is visible, and the only one that filters by
 * date — public is always lifetime.
 *
 * `from`/`to` are epoch ms and are passed in by the client rather than read
 * off the clock here: a query is not rerun merely because time advances, so a
 * server-side `Date.now()` would go stale and would poison the query cache.
 */
export const getDashboardStats = query({
	args: {
		campaignId: v.id('campaigns'),
		from: v.optional(v.number()),
		to: v.optional(v.number())
	},
	handler: async (ctx, args): Promise<ResolvedStat[]> => {
		const orgId = await readableOrgId(ctx, 'projects:read', args.campaignId);
		if (!orgId) {
			return [];
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return [];
		}

		return await computeStats(ctx, campaign, {
			surface: 'dashboard',
			window: { from: args.from, to: args.to }
		});
	}
});

export const getCampaignBySlug = query({
	args: {
		slug: v.string()
	},
	handler: async (ctx, args) => {
		// Same double gate as getCampaign: the slug names no campaign until the
		// row is loaded, so the first check is org-wide and the second is scoped
		// to the campaign the slug actually resolved to.
		const orgId = await readableOrgId(ctx, 'projects:read');
		if (!orgId) {
			return null;
		}

		const campaign = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId_and_slug', (q) => q.eq('orgId', orgId).eq('slug', args.slug))
			.unique();
		if (!campaign) {
			return null;
		}

		const scopedOrgId = await readableOrgId(ctx, 'projects:read', campaign._id);
		if (!scopedOrgId) {
			return null;
		}

		return await withImageUrls(ctx, campaign);
	}
});
