import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { query } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { readableOrgId } from '../model/access';
import { normalizeEmail } from '../model/contacts';

/**
 * A picker showing a hundred names is already showing too many to scan; the
 * ceiling exists so a caller asking for more cannot reintroduce the full-table
 * read this file was built to remove.
 */
const DEFAULT_CONTACT_LIMIT = 100;
const MAX_CONTACT_LIMIT = 200;

/**
 * How many contacts this org has, without reading any of them.
 *
 * The dashboard's People tile used to subscribe to the whole contact list and
 * call `.length` on it — every row in the org, on every tick, to render one
 * integer. Convex has no count operator, so the number is maintained on write
 * by the trigger in `functions.ts` and read from one row here.
 */
export const countContacts = query({
	args: {},
	handler: async (ctx): Promise<number> => {
		const orgId = await readableOrgId(ctx, 'contacts:read');
		if (!orgId) return 0;

		const totals = await ctx.db
			.query('orgContactTotals')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.unique();
		return totals?.contactCount ?? 0;
	}
});

/**
 * Contacts, for pickers and typeaheads. Always bounded.
 *
 * Two things changed here and the second matters more than the first.
 *
 * The read is now clamped rather than optionally limited. Every caller that
 * omitted `limit` was reading the org's entire contact list — eight of them,
 * three subscribed permanently — so "unbounded unless you remember" was the
 * wrong default for a table that grows with every donor.
 *
 * And search goes through a full-text index instead of loading the org and
 * filtering in JavaScript. That old path ran on EVERY KEYSTROKE of the admin
 * directory's search box, and `limit` did not bound it: the slice happened
 * after the whole table was already in memory.
 *
 * Search semantics change with the index, honestly and for the better on
 * balance: Convex full-text matches whole words with prefix matching on the
 * last one, where the old filter matched a substring anywhere. So "ada" still
 * finds "Ada Lovelace", but "lace" no longer does. In exchange, results are
 * relevance-ordered and the query stops reading the whole organization.
 */
export const listContacts = query({
	args: {
		search: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args): Promise<Doc<'contacts'>[]> => {
		const orgId = await readableOrgId(ctx, 'contacts:read');
		if (!orgId) {
			return [];
		}

		const take = Math.min(args.limit ?? DEFAULT_CONTACT_LIMIT, MAX_CONTACT_LIMIT);
		const needle = args.search?.trim().toLowerCase();

		if (needle === undefined || needle === '') {
			return await ctx.db
				.query('contacts')
				.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
				.take(take);
		}

		// `.eq('orgId', orgId)` is the tenant boundary. A search index does not
		// inherit the isolation that `withIndex(q.eq('orgId', ...))` gives every
		// other query here for free, so omitting it would match people across
		// every organization on the platform.
		return await ctx.db
			.query('contacts')
			.withSearchIndex('search_contacts', (q) =>
				q.search('searchText', needle).eq('orgId', orgId)
			)
			.take(take);
	}
});

/**
 * One page of the contact directory, for the admin browse screen.
 *
 * Separate from `listContacts` because the two want opposite things: a picker
 * wants the best handful of matches and can truncate silently, while a
 * directory has to be able to reach every person eventually. Truncating THAT
 * at a hundred would quietly hide contacts from the only screen that exists to
 * find them.
 */
export const pageContacts = query({
	args: {
		paginationOpts: paginationOptsValidator,
		search: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const orgId = await readableOrgId(ctx, 'contacts:read');
		if (!orgId) {
			return { page: [], isDone: true, continueCursor: '' };
		}

		const needle = args.search?.trim().toLowerCase();
		if (needle === undefined || needle === '') {
			return await ctx.db
				.query('contacts')
				.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
				.paginate(args.paginationOpts);
		}

		return await ctx.db
			.query('contacts')
			.withSearchIndex('search_contacts', (q) =>
				q.search('searchText', needle).eq('orgId', orgId)
			)
			.paginate(args.paginationOpts);
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
