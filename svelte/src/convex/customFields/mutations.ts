import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireCapability } from '../model/access';
import { loadPublicPolicy } from '../model/policy';
import {
	assertCategoryUsable,
	assertKeyAvailable,
	assertKeyNotProtectedIfPublic,
	assertOptionsShape,
	assertScopeShape,
	attributeValueValidator,
	fieldEntityValidator,
	fieldScopeValidator,
	fieldTypeValidator,
	requireCampaign,
	requireCategory,
	requireFieldDefinition,
	validateAttributes
} from '../model/customFields';

export const createCategory = mutation({
	args: {
		entity: fieldEntityValidator,
		scope: fieldScopeValidator,
		campaignId: v.optional(v.id('campaigns')),
		name: v.string(),
		order: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');
		assertScopeShape(args.scope, args.campaignId);
		if (args.campaignId !== undefined) {
			await requireCampaign(ctx, orgId, args.campaignId);
		}

		return await ctx.db.insert('customFieldCategories', {
			orgId,
			entity: args.entity,
			scope: args.scope,
			campaignId: args.campaignId,
			name: args.name,
			order: args.order ?? 0
		});
	}
});

export const updateCategory = mutation({
	args: {
		categoryId: v.id('customFieldCategories'),
		name: v.optional(v.string()),
		order: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');
		await requireCategory(ctx, orgId, args.categoryId);

		const { categoryId, ...updates } = args;

		const patch: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(updates)) {
			if (value !== undefined) {
				patch[key] = value;
			}
		}

		await ctx.db.patch(
			'customFieldCategories',
			categoryId,
			patch as Partial<Doc<'customFieldCategories'>>
		);
		return categoryId;
	}
});

export const deleteCategory = mutation({
	args: {
		categoryId: v.id('customFieldCategories')
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');
		await requireCategory(ctx, orgId, args.categoryId);

		// The fields survive as uncategorized — deleting a grouping must never
		// delete the definitions whose values are stored on every record.
		const fields = await ctx.db
			.query('customFieldDefinitions')
			.withIndex('by_categoryId', (q) => q.eq('categoryId', args.categoryId))
			.collect();
		for (const field of fields) {
			await ctx.db.patch('customFieldDefinitions', field._id, { categoryId: undefined });
		}

		await ctx.db.delete('customFieldCategories', args.categoryId);
		return null;
	}
});

export const createFieldDefinition = mutation({
	args: {
		entity: fieldEntityValidator,
		scope: fieldScopeValidator,
		campaignId: v.optional(v.id('campaigns')),
		categoryId: v.optional(v.id('customFieldCategories')),
		key: v.string(),
		label: v.string(),
		type: fieldTypeValidator,
		options: v.optional(v.array(v.string())),
		order: v.optional(v.number()),
		isRequired: v.optional(v.boolean()),
		isPublic: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');
		assertScopeShape(args.scope, args.campaignId);
		if (args.campaignId !== undefined) {
			await requireCampaign(ctx, orgId, args.campaignId);
		}
		if (args.categoryId !== undefined) {
			await assertCategoryUsable(ctx, orgId, args.entity, args.campaignId, args.categoryId);
		}

		const key = args.key.trim();
		if (key === '') {
			throw new ConvexError('Field key is required');
		}
		assertOptionsShape(args.type, args.options);
		const policy = await loadPublicPolicy(ctx, orgId);
		assertKeyNotProtectedIfPublic(key, args.isPublic, policy.extraProtectedKeys);
		await assertKeyAvailable(ctx, orgId, args.entity, args.scope, args.campaignId, key);

		return await ctx.db.insert('customFieldDefinitions', {
			orgId,
			entity: args.entity,
			scope: args.scope,
			campaignId: args.campaignId,
			categoryId: args.categoryId,
			key,
			label: args.label,
			type: args.type,
			options: args.type === 'select' ? args.options : undefined,
			order: args.order ?? 0,
			isRequired: args.isRequired ?? false,
			// Private until someone deliberately publishes it.
			isPublic: args.isPublic ?? false
		});
	}
});

// `key`, `entity`, `scope` and `campaignId` are deliberately absent — values are
// stored under the key in each record's own bag, so changing any of them would
// orphan every value already written.
export const updateFieldDefinition = mutation({
	args: {
		fieldId: v.id('customFieldDefinitions'),
		categoryId: v.optional(v.union(v.id('customFieldCategories'), v.null())),
		label: v.optional(v.string()),
		type: v.optional(fieldTypeValidator),
		options: v.optional(v.array(v.string())),
		order: v.optional(v.number()),
		isRequired: v.optional(v.boolean()),
		isPublic: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');
		const field = await requireFieldDefinition(ctx, orgId, args.fieldId);

		if (args.isPublic !== undefined) {
			const policy = await loadPublicPolicy(ctx, orgId);
			assertKeyNotProtectedIfPublic(field.key, args.isPublic, policy.extraProtectedKeys);
		}

		const patch: Record<string, unknown> = {};
		if (args.label !== undefined) {
			patch.label = args.label;
		}
		if (args.order !== undefined) {
			patch.order = args.order;
		}
		if (args.isRequired !== undefined) {
			patch.isRequired = args.isRequired;
		}
		if (args.isPublic !== undefined) {
			patch.isPublic = args.isPublic;
		}

		if (args.categoryId !== undefined) {
			if (args.categoryId === null) {
				patch.categoryId = undefined;
			} else {
				await assertCategoryUsable(ctx, orgId, field.entity, field.campaignId, args.categoryId);
				patch.categoryId = args.categoryId;
			}
		}

		if (args.type !== undefined || args.options !== undefined) {
			const type = args.type ?? field.type;
			const options = args.options ?? field.options;
			assertOptionsShape(type, options);
			patch.type = type;
			patch.options = type === 'select' ? options : undefined;
		}

		await ctx.db.patch(
			'customFieldDefinitions',
			args.fieldId,
			patch as Partial<Doc<'customFieldDefinitions'>>
		);
		return args.fieldId;
	}
});

export const deleteFieldDefinition = mutation({
	args: {
		fieldId: v.id('customFieldDefinitions')
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'settings:manage');
		await requireFieldDefinition(ctx, orgId, args.fieldId);

		await ctx.db.delete('customFieldDefinitions', args.fieldId);
		return null;
	}
});

export const setRecordAttributes = mutation({
	args: {
		entity: fieldEntityValidator,
		recordId: v.union(v.id('projects'), v.id('contacts'), v.id('campaigns')),
		attributes: v.record(v.string(), attributeValueValidator),
		// Only meaningful for entity 'contact': which campaign's fields the
		// caller was editing, so a campaign-scope value can be saved at all.
		// Projects and campaigns already know their own campaignId.
		campaignId: v.optional(v.id('campaigns'))
	},
	handler: async (ctx, args) => {
		// Setting values is writing to a record, so the capability follows the
		// record's own entity rather than a single "custom fields" permission.
		// Gate org-wide first, on the capability the entity implies, to establish
		// the caller; the campaign-scoped branches gate again once the row (and
		// its campaignId) is loaded.
		const capability =
			args.entity === 'project'
				? 'projects:write'
				: args.entity === 'campaign'
					? 'campaign:edit'
					: 'contacts:write';
		const { orgId } = await requireCapability(ctx, capability);

		if (args.entity === 'project') {
			const projectId = args.recordId as Id<'projects'>;
			const project = await ctx.db.get('projects', projectId);
			if (!project || project.orgId !== orgId) {
				throw new ConvexError('Project not found');
			}
			await requireCapability(ctx, 'projects:write', project.campaignId);
			const attributes = await validateAttributes(
				ctx,
				orgId,
				'project',
				project.campaignId,
				args.attributes
			);
			await ctx.db.patch('projects', projectId, { attributes });
			return projectId;
		}

		if (args.entity === 'campaign') {
			const campaignId = args.recordId as Id<'campaigns'>;
			const campaign = await requireCampaign(ctx, orgId, campaignId);
			await requireCapability(ctx, 'campaign:edit', campaign._id);
			const attributes = await validateAttributes(
				ctx,
				orgId,
				'campaign',
				campaign._id,
				args.attributes
			);
			await ctx.db.patch('campaigns', campaignId, { attributes });
			return campaignId;
		}

		// Contacts have no campaign of their own, so `contacts:write` was already
		// checked org-wide above — there is no row-level campaignId to re-check.
		const contactId = args.recordId as Id<'contacts'>;
		const contact = await ctx.db.get('contacts', contactId);
		if (!contact || contact.orgId !== orgId) {
			throw new ConvexError('Contact not found');
		}
		// A contact belongs to the org, not to any one campaign, so its fields are
		// always org-scope UNLESS the caller is editing it from inside a campaign
		// (campaignId set), in which case that campaign's own fields apply too —
		// same inheritance resolveForRecord already gives projects and campaigns.
		if (args.campaignId !== undefined) {
			await requireCampaign(ctx, orgId, args.campaignId);
			// Naming a campaign here decides which fields may be written, so the
			// caller has to hold the capability in THAT campaign, not merely
			// somewhere.
			await requireCapability(ctx, 'contacts:write', args.campaignId);
		}
		const customFields = await validateAttributes(
			ctx,
			orgId,
			'contact',
			args.campaignId ?? null,
			args.attributes
		);
		await ctx.db.patch('contacts', contactId, { customFields });
		return contactId;
	}
});
