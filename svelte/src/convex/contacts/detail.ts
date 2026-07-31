import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAccess } from '../model/access';
import { can } from '../../lib/domain/permissions';

/** Households this contact belongs to, each with its full member list. */
export const listHouseholdsForContact = query({
	args: { contactId: v.id('contacts') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId || !can(access, 'contacts:read')) return [];

		const links = await ctx.db
			.query('householdMembers')
			.withIndex('by_contactId', (q) => q.eq('contactId', args.contactId))
			.collect();

		const mine = links.filter((link) => link.orgId === access.orgId);

		return await Promise.all(
			mine.map(async (link) => {
				const household = await ctx.db.get('households', link.householdId);
				const memberLinks = household
					? await ctx.db
							.query('householdMembers')
							.withIndex('by_householdId', (q) => q.eq('householdId', household._id))
							.collect()
					: [];
				const members = await Promise.all(
					memberLinks.map(async (member) => ({
						...member,
						contact: await ctx.db.get('contacts', member.contactId)
					}))
				);
				return { membership: link, household, members };
			})
		);
	}
});

/**
 * The child rows behind a contact's projected fields, plus background checks
 * and anything else that only lives on the child tables. Background checks
 * and medical notes are sensitive, so this follows the same org-scoped,
 * deny-by-default access check as the rest of this file rather than trusting
 * the caller's contactId.
 */
export const listContactInfo = query({
	args: { contactId: v.id('contacts') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId || !can(access, 'contacts:read')) {
			return { emails: [], phones: [], addresses: [], backgroundChecks: [] };
		}

		const [emails, phones, addresses, backgroundChecks] = await Promise.all([
			ctx.db
				.query('contactEmails')
				.withIndex('by_contactId', (q) => q.eq('contactId', args.contactId))
				.collect(),
			ctx.db
				.query('contactPhones')
				.withIndex('by_contactId', (q) => q.eq('contactId', args.contactId))
				.collect(),
			ctx.db
				.query('contactAddresses')
				.withIndex('by_contactId', (q) => q.eq('contactId', args.contactId))
				.collect(),
			ctx.db
				.query('contactBackgroundChecks')
				.withIndex('by_contactId', (q) => q.eq('contactId', args.contactId))
				.collect()
		]);

		return {
			emails: emails.filter((row) => row.orgId === access.orgId),
			phones: phones.filter((row) => row.orgId === access.orgId),
			addresses: addresses.filter((row) => row.orgId === access.orgId),
			backgroundChecks: backgroundChecks.filter((row) => row.orgId === access.orgId)
		};
	}
});

/**
 * Donations attributed to this contact, with the projects each one was
 * allocated to, plus the lifetime total. Transfers and expenditures are
 * excluded: a donor gives, they do not spend.
 */
export const listDonationsForContact = query({
	args: { contactId: v.id('contacts') },
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId || !can(access, 'money:read')) {
			return { donations: [], totalCents: 0 };
		}

		const transactions = await ctx.db
			.query('transactions')
			.withIndex('by_contactId', (q) => q.eq('contactId', args.contactId))
			.collect();

		const donations = transactions.filter(
			(transaction) => transaction.orgId === access.orgId && transaction.type === 'donation'
		);

		const withAllocations = await Promise.all(
			donations.map(async (donation) => {
				const allocations = await ctx.db
					.query('allocations')
					.withIndex('by_transactionId', (q) => q.eq('transactionId', donation._id))
					.collect();

				const projects = await Promise.all(
					allocations.map(async (allocation) => ({
						amountCents: allocation.amountCents,
						project: allocation.projectId
							? await ctx.db.get('projects', allocation.projectId)
							: null
					}))
				);

				return { ...donation, projects };
			})
		);

		return {
			donations: withAllocations,
			totalCents: donations.reduce((sum, donation) => sum + donation.amountCents, 0)
		};
	}
});
