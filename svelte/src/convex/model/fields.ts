// Loading custom-field DEFINITIONS from the db, shaped for the pure helpers in
// lib/domain/field-definitions.ts.
//
// Its own module rather than a helper inside the privacy wall because two
// callers need it and neither should have to import the other: the wall
// (model/public.ts) scrubs a project's attributes with it, and the stat engine
// (model/stats.ts) needs the same definitions to decide whether a field-sourced
// stat is publishable at all.

import type { QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { resolveFieldDefinitions, type FieldDefinition } from '../../lib/domain/field-definitions';

/**
 * Every field definition that applies to a project in this campaign — the
 * org-wide ones plus the campaign's own, campaign overriding org on a shared
 * key. Definitions are returned WHOLE, private ones included: this resolves
 * what exists, it does not decide what may be shown. `isPublic` on each row is
 * how a caller makes that decision.
 */
export async function resolveProjectFieldDefs(
	ctx: QueryCtx,
	orgId: string,
	campaignId: Id<'campaigns'>
): Promise<FieldDefinition[]> {
	return resolveEntityFieldDefs(ctx, orgId, 'project', campaignId);
}

/**
 * The same for the CONTACT entity, which member stats read: a stat can count
 * the people whose contact field says something, and that decision needs the
 * definition's own `isPublic` just as a project-field stat does.
 */
export async function resolveContactFieldDefs(
	ctx: QueryCtx,
	orgId: string,
	campaignId: Id<'campaigns'>
): Promise<FieldDefinition[]> {
	return resolveEntityFieldDefs(ctx, orgId, 'contact', campaignId);
}

async function resolveEntityFieldDefs(
	ctx: QueryCtx,
	orgId: string,
	entity: 'project' | 'contact',
	campaignId: Id<'campaigns'>
): Promise<FieldDefinition[]> {
	const rows = await ctx.db
		.query('customFieldDefinitions')
		.withIndex('by_orgId_and_entity', (q) => q.eq('orgId', orgId).eq('entity', entity))
		.collect();

	// Fail closed on a malformed row rather than trusting the write path: an
	// org-scope row must carry no campaignId, a campaign-scope row must carry
	// one. A mislabelled row would otherwise apply to every campaign.
	const wellFormed = rows.filter((row) =>
		row.scope === 'org' ? row.campaignId === undefined : row.campaignId !== undefined
	);

	const defs: FieldDefinition[] = wellFormed.map((row) => ({
		id: row._id,
		entity: row.entity,
		scope: row.scope,
		campaignId: row.campaignId ?? null,
		categoryId: row.categoryId ?? null,
		key: row.key,
		label: row.label,
		type: row.type,
		options: row.options ?? null,
		order: row.order,
		isPublic: row.isPublic,
		isRequired: row.isRequired
	}));

	return resolveFieldDefinitions(defs, entity, campaignId);
}
