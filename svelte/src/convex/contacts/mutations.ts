import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { requireOrgId } from '../model/auth';
import { deleteContactCascade } from '../model/cascade';
import {
	assertAuthUserAvailable,
	assertEmailAvailable,
	createContactModel,
	emailFields,
	preferredContactValidator,
	requireContact,
	transparencyValidator
} from '../model/contacts';

const contactFields = {
	name: v.string(),
	email: v.optional(v.string()),
	phone: v.optional(v.string()),
	organization: v.optional(v.string()),
	addressLine1: v.optional(v.string()),
	addressLine2: v.optional(v.string()),
	city: v.optional(v.string()),
	state: v.optional(v.string()),
	postalCode: v.optional(v.string()),
	country: v.optional(v.string()),
	notes: v.optional(v.string()),
	source: v.optional(v.string()),
	transparency: v.optional(transparencyValidator),
	preferredContact: v.optional(preferredContactValidator)
};

export const createContact = mutation({
	args: contactFields,
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		return await createContactModel(ctx, { ...args, orgId });
	}
});

// authUserId is deliberately absent — linking a portal login is its own
// mutation so the per-org uniqueness check can never be bypassed.
export const updateContact = mutation({
	args: {
		contactId: v.id('contacts'),
		...contactFields,
		name: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireContact(ctx, orgId, args.contactId);

		const { contactId, ...updates } = args;

		const patch: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(updates)) {
			if (value !== undefined) {
				patch[key] = value;
			}
		}

		// email and emailLower are always written as a pair, so the dedup key can
		// never drift from the displayed address. An empty string clears both.
		if (updates.email !== undefined) {
			const fields = emailFields(updates.email);
			await assertEmailAvailable(ctx, orgId, fields.emailLower, contactId);
			patch.email = fields.email;
			patch.emailLower = fields.emailLower;
		}

		await ctx.db.patch('contacts', contactId, patch as Partial<Doc<'contacts'>>);
		return contactId;
	}
});

export const linkAuthUser = mutation({
	args: {
		contactId: v.id('contacts'),
		authUserId: v.string()
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireContact(ctx, orgId, args.contactId);
		await assertAuthUserAvailable(ctx, orgId, args.authUserId, args.contactId);

		await ctx.db.patch('contacts', args.contactId, { authUserId: args.authUserId });
		return args.contactId;
	}
});

export const unlinkAuthUser = mutation({
	args: {
		contactId: v.id('contacts')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireContact(ctx, orgId, args.contactId);

		await ctx.db.patch('contacts', args.contactId, { authUserId: undefined });
		return args.contactId;
	}
});

export const markInvited = mutation({
	args: {
		contactId: v.id('contacts')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireContact(ctx, orgId, args.contactId);

		await ctx.db.patch('contacts', args.contactId, { invitedAt: Date.now() });
		return args.contactId;
	}
});

export const deleteContact = mutation({
	args: {
		contactId: v.id('contacts')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireContact(ctx, orgId, args.contactId);

		await deleteContactCascade(ctx, args.contactId);
		return null;
	}
});
