import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { readableOrgId } from '../model/access';
import { fieldEntityValidator, resolveForRecord } from '../model/customFields';

// Custom fields describe how a record is displayed, not a surface of their
// own, so every query here gates on `projects:read` — whoever may read a
// record needs its field definitions too.

function byOrderThenName(a: Doc<'customFieldCategories'>, b: Doc<'customFieldCategories'>): number {
	return a.order - b.order || a.name.localeCompare(b.name);
}

function byOrderThenKey(
	a: Doc<'customFieldDefinitions'>,
	b: Doc<'customFieldDefinitions'>
): number {
	return a.order - b.order || a.key.localeCompare(b.key);
}

export const listCategories = query({
	args: {
		entity: fieldEntityValidator,
		campaignId: v.optional(v.id('campaigns'))
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'projects:read', args.campaignId);
		if (!orgId) {
			return [];
		}

		const orgRows = await ctx.db
			.query('customFieldCategories')
			.withIndex('by_orgId_and_entity', (q) => q.eq('orgId', orgId).eq('entity', args.entity))
			.collect();
		const categories = orgRows.filter((row) => row.scope === 'org');

		const campaignId = args.campaignId;
		if (campaignId !== undefined) {
			const campaignRows = await ctx.db
				.query('customFieldCategories')
				.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
				.collect();
			for (const row of campaignRows) {
				if (row.orgId === orgId && row.entity === args.entity) {
					categories.push(row);
				}
			}
		}

		return categories.sort(byOrderThenName);
	}
});

// Raw rows, both scopes — the admin editing view needs to see where each
// definition came from. Use resolveFields for the set a record actually gets.
export const listFieldDefinitions = query({
	args: {
		entity: fieldEntityValidator,
		campaignId: v.optional(v.id('campaigns'))
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'projects:read', args.campaignId);
		if (!orgId) {
			return [];
		}

		const rows = await ctx.db
			.query('customFieldDefinitions')
			.withIndex('by_orgId_and_entity', (q) => q.eq('orgId', orgId).eq('entity', args.entity))
			.collect();

		return rows
			.filter((row) => row.scope === 'org' || row.campaignId === args.campaignId)
			.sort(byOrderThenKey);
	}
});

export const resolveFields = query({
	args: {
		entity: fieldEntityValidator,
		campaignId: v.optional(v.id('campaigns'))
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'projects:read', args.campaignId);
		if (!orgId) {
			return [];
		}

		return await resolveForRecord(ctx, orgId, args.entity, args.campaignId ?? null);
	}
});
