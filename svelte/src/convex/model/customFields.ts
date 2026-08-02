import { ConvexError, v } from 'convex/values';
import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { FieldDefinition, FieldEntity, FieldScope } from '../../lib/domain/field-definitions';
import {
	coerceFieldValue,
	isProtectedFieldKey,
	missingRequiredFields,
	resolveFieldDefinitions
} from '../../lib/domain/field-definitions';

export const fieldEntityValidator = v.union(
	v.literal('contact'),
	v.literal('project'),
	v.literal('campaign')
);

export const fieldScopeValidator = v.union(v.literal('org'), v.literal('campaign'));

export const fieldTypeValidator = v.union(
	v.literal('text'),
	v.literal('longtext'),
	v.literal('number'),
	v.literal('money'),
	v.literal('date'),
	v.literal('select'),
	v.literal('boolean')
);

export const attributeValueValidator = v.union(v.string(), v.number(), v.boolean(), v.null());

export type AttributeValue = string | number | boolean | null;
export type AttributeBag = Record<string, AttributeValue>;

/** A stored row in the shape the domain module works with (optionals become nulls). */
export function docToFieldDefinition(doc: Doc<'customFieldDefinitions'>): FieldDefinition {
	return {
		id: doc._id,
		entity: doc.entity,
		scope: doc.scope,
		campaignId: doc.campaignId ?? null,
		categoryId: doc.categoryId ?? null,
		key: doc.key,
		label: doc.label,
		type: doc.type,
		options: doc.options ?? null,
		order: doc.order,
		isPublic: doc.isPublic,
		isRequired: doc.isRequired
	};
}

/** Every definition row the org has for an entity, both scopes, all campaigns. */
export async function entityDefinitionDocs(
	ctx: QueryCtx,
	orgId: string,
	entity: FieldEntity
): Promise<Doc<'customFieldDefinitions'>[]> {
	return await ctx.db
		.query('customFieldDefinitions')
		.withIndex('by_orgId_and_entity', (q) => q.eq('orgId', orgId).eq('entity', entity))
		.collect();
}

/** The inherited set that applies to one record: org-wide fields plus its campaign's. */
export async function resolveForRecord(
	ctx: QueryCtx,
	orgId: string,
	entity: FieldEntity,
	campaignId: Id<'campaigns'> | null
): Promise<FieldDefinition[]> {
	const docs = await entityDefinitionDocs(ctx, orgId, entity);
	return resolveFieldDefinitions(docs.map(docToFieldDefinition), entity, campaignId);
}

// Scope and campaignId are one fact stored twice; resolution reads both, so a
// mismatched pair would silently drop the row out of every applicable set.
export function assertScopeShape(scope: FieldScope, campaignId: Id<'campaigns'> | undefined): void {
	if (scope === 'org' && campaignId !== undefined) {
		throw new ConvexError('Org-scope rows must not name a campaign');
	}
	if (scope === 'campaign' && campaignId === undefined) {
		throw new ConvexError('Campaign-scope rows must name a campaign');
	}
}

/**
 * Org scope and campaign scope are two separate key namespaces: a key is unique
 * within (orgId, entity) at org scope and within (campaignId, entity) at
 * campaign scope, so the same key may exist in both — that pairing is an override.
 */
export async function assertKeyAvailable(
	ctx: QueryCtx,
	orgId: string,
	entity: FieldEntity,
	scope: FieldScope,
	campaignId: Id<'campaigns'> | undefined,
	key: string,
	excludeId?: Id<'customFieldDefinitions'>
): Promise<void> {
	if (scope === 'campaign') {
		const siblings = await ctx.db
			.query('customFieldDefinitions')
			.withIndex('by_campaignId_and_entity_and_key', (q) =>
				q.eq('campaignId', campaignId).eq('entity', entity).eq('key', key)
			)
			.collect();
		if (siblings.some((row) => row._id !== excludeId)) {
			throw new ConvexError(`Field key already in use for this campaign: ${key}`);
		}
		return;
	}

	const siblings = await ctx.db
		.query('customFieldDefinitions')
		.withIndex('by_orgId_and_entity_and_key', (q) =>
			q.eq('orgId', orgId).eq('entity', entity).eq('key', key)
		)
		.collect();
	if (siblings.some((row) => row.scope === 'org' && row._id !== excludeId)) {
		throw new ConvexError(`Field key already in use for this organization: ${key}`);
	}
}

// The isPublic checkbox is admin-settable and this app serves people
// escaping forced labour, so a protected key (site references, phone
// numbers, addresses, locations, ops notes) can never be marked public —
// checked on both create and update, independent of the read-time filter in
// publicAttributes.
export function assertKeyNotProtectedIfPublic(
	key: string,
	isPublic: boolean | undefined,
	/** The org's own additions to the shared denylist. */
	extraProtectedKeys: string[] = []
): void {
	if (isPublic && isProtectedFieldKey(key, extraProtectedKeys)) {
		throw new ConvexError(`Field key cannot be made public: ${key}`);
	}
}

export function assertOptionsShape(
	type: FieldDefinition['type'],
	options: string[] | undefined
): void {
	if (type === 'select') {
		if (options === undefined || options.length === 0) {
			throw new ConvexError('A select field needs at least one option');
		}
		return;
	}
	if (options !== undefined && options.length > 0) {
		throw new ConvexError(`Options are only valid on a select field, not ${type}`);
	}
}

export async function requireCampaign(
	ctx: QueryCtx,
	orgId: string,
	campaignId: Id<'campaigns'>
): Promise<Doc<'campaigns'>> {
	const campaign = await ctx.db.get('campaigns', campaignId);
	if (!campaign || campaign.orgId !== orgId) {
		throw new ConvexError('Campaign not found');
	}
	return campaign;
}

export async function requireCategory(
	ctx: QueryCtx,
	orgId: string,
	categoryId: Id<'customFieldCategories'>
): Promise<Doc<'customFieldCategories'>> {
	const category = await ctx.db.get('customFieldCategories', categoryId);
	if (!category || category.orgId !== orgId) {
		throw new ConvexError('Category not found');
	}
	return category;
}

export async function requireFieldDefinition(
	ctx: QueryCtx,
	orgId: string,
	fieldId: Id<'customFieldDefinitions'>
): Promise<Doc<'customFieldDefinitions'>> {
	const field = await ctx.db.get('customFieldDefinitions', fieldId);
	if (!field || field.orgId !== orgId) {
		throw new ConvexError('Field definition not found');
	}
	return field;
}

/** A category may only hold fields it actually applies to. */
export async function assertCategoryUsable(
	ctx: QueryCtx,
	orgId: string,
	entity: FieldEntity,
	campaignId: Id<'campaigns'> | undefined,
	categoryId: Id<'customFieldCategories'>
): Promise<void> {
	const category = await requireCategory(ctx, orgId, categoryId);
	if (category.entity !== entity) {
		throw new ConvexError('Category belongs to a different entity');
	}
	if (category.scope === 'campaign' && category.campaignId !== campaignId) {
		throw new ConvexError('Category belongs to a different campaign');
	}
}

function coerceValue(def: FieldDefinition, value: AttributeValue): AttributeValue {
	if (value === null) {
		return null;
	}

	// A string is raw form input, so the domain coercer owns parsing and option
	// checking (money arrives as dollars there); an already-typed value is in
	// stored shape (money in cents) and only needs a shape check.
	if (typeof value === 'string') {
		try {
			return coerceFieldValue(def, value) as AttributeValue;
		} catch (error) {
			throw new ConvexError(
				error instanceof Error ? error.message : `Invalid value for ${def.label}`
			);
		}
	}

	if (def.type === 'number' || def.type === 'money') {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new ConvexError(`${def.label} must be a number`);
		}
		// Money is integer cents everywhere in this codebase. A numeric value is
		// already in stored shape, so a fractional one means the caller passed
		// dollars — reject rather than silently storing 10.50 as 10.5 cents.
		if (def.type === 'money' && !Number.isInteger(value)) {
			throw new ConvexError(
				`${def.label} must be a whole number of cents (send dollars as a string)`
			);
		}
		return value;
	}
	if (def.type === 'boolean') {
		if (typeof value !== 'boolean') {
			throw new ConvexError(`${def.label} must be true or false`);
		}
		return value;
	}

	throw new ConvexError(`${def.label} must be text`);
}

/**
 * Validate a whole value bag against the definitions resolved for the record,
 * returning the cleaned bag. Unset values are dropped rather than stored as null.
 */
export async function validateAttributes(
	ctx: QueryCtx,
	orgId: string,
	entity: FieldEntity,
	campaignId: Id<'campaigns'> | null,
	attributes: AttributeBag
): Promise<AttributeBag> {
	const defs = await resolveForRecord(ctx, orgId, entity, campaignId);
	const byKey = new Map(defs.map((def) => [def.key, def]));

	const cleaned: AttributeBag = {};
	for (const [key, value] of Object.entries(attributes)) {
		const def = byKey.get(key);
		if (!def) {
			throw new ConvexError(`Unknown field: ${key}`);
		}
		const coerced = coerceValue(def, value);
		if (coerced !== null) {
			cleaned[key] = coerced;
		}
	}

	const missing = missingRequiredFields(defs, cleaned);
	if (missing.length > 0) {
		throw new ConvexError(`Missing required fields: ${missing.join(', ')}`);
	}

	return cleaned;
}
