import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { readableOrgId } from '../model/access';
import { normalizeEmail } from '../model/contacts';

function matchesSearch(contact: Doc<'contacts'>, needle: string): boolean {
	return (
		contact.firstName.toLowerCase().includes(needle) ||
		(contact.lastName?.toLowerCase().includes(needle) ?? false) ||
		(contact.nickname?.toLowerCase().includes(needle) ?? false) ||
		(contact.givenName?.toLowerCase().includes(needle) ?? false) ||
		(contact.middleName?.toLowerCase().includes(needle) ?? false) ||
		(contact.emailLower ?? '').includes(needle) ||
		(contact.organization ?? '').toLowerCase().includes(needle)
	);
}

export const listContacts = query({
	args: {
		search: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'contacts:read');
		if (!orgId) {
			return [];
		}

		const rows = ctx.db.query('contacts').withIndex('by_orgId', (q) => q.eq('orgId', orgId));

		const needle = args.search?.trim().toLowerCase();
		if (needle === undefined || needle === '') {
			return args.limit === undefined ? await rows.collect() : await rows.take(args.limit);
		}

		// Convex has no ILIKE, so substring matching is a JS filter over the org's
		// contacts. A search index would replace this if the table grows large.
		const matches = (await rows.collect()).filter((contact) => matchesSearch(contact, needle));
		return args.limit === undefined ? matches : matches.slice(0, args.limit);
	}
});

export const getContact = query({
	args: {
		contactId: v.id('contacts')
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'contacts:read');
		if (!orgId) {
			return null;
		}

		const contact = await ctx.db.get('contacts', args.contactId);
		if (!contact || contact.orgId !== orgId) {
			return null;
		}

		return contact;
	}
});

export const getContactByEmail = query({
	args: {
		email: v.string()
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'contacts:read');
		if (!orgId) {
			return null;
		}

		const emailLower = normalizeEmail(args.email);
		if (emailLower === undefined) {
			return null;
		}

		return await ctx.db
			.query('contacts')
			.withIndex('by_orgId_and_emailLower', (q) =>
				q.eq('orgId', orgId).eq('emailLower', emailLower)
			)
			.unique();
	}
});

export const getContactByAuthUserId = query({
	args: {
		authUserId: v.string()
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'contacts:read');
		if (!orgId) {
			return null;
		}

		return await ctx.db
			.query('contacts')
			.withIndex('by_orgId_and_authUserId', (q) =>
				q.eq('orgId', orgId).eq('authUserId', args.authUserId)
			)
			.unique();
	}
});
