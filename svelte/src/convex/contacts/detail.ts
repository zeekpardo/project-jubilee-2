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
 *
 * With a campaignId, this narrows to that campaign's slice of the giving: a
 * donation only appears if at least one of its allocations belongs to the
 * campaign, and both the donation's reported amount and the running total are
 * rebuilt from just those allocations — a donation split across campaigns
 * must not report its whole value against any one of them.
 */
export const listDonationsForContact = query({
	args: { contactId: v.id('contacts'), campaignId: v.optional(v.id('campaigns')) },
	handler: async (ctx, args) => {
		// Scoped to the campaign when one is named, so asking for a campaign's
		// slice of a donor's giving cannot become a way around campaign
		// assignment. Unscoped without one, which is the org-wide admin view.
		const access = await getAccess(ctx);
		if (!access.orgId || !can(access, 'money:read', args.campaignId)) {
			return { donations: [], totalCents: 0 };
		}

		const transactions = await ctx.db
			.query('transactions')
			.withIndex('by_contactId', (q) => q.eq('contactId', args.contactId))
			.collect();

		const donations = transactions.filter(
			(transaction) => transaction.orgId === access.orgId && transaction.type === 'donation'
		);

		const campaignId = args.campaignId;

		const scoped = await Promise.all(
			donations.map(async (donation) => {
				const allocations = await ctx.db
					.query('allocations')
					.withIndex('by_transactionId', (q) => q.eq('transactionId', donation._id))
					.collect();

				const relevant =
					campaignId === undefined
						? allocations
						: allocations.filter((allocation) => allocation.campaignId === campaignId);

				// No allocation in this campaign means the donation is not part of
				// this campaign's giving at all, not that it is worth $0 here.
				if (campaignId !== undefined && relevant.length === 0) return null;

				const projects = await Promise.all(
					relevant.map(async (allocation) => ({
						amountCents: allocation.amountCents,
						project: allocation.projectId
							? await ctx.db.get('projects', allocation.projectId)
							: null
					}))
				);

				const amountCents =
					campaignId === undefined
						? donation.amountCents
						: relevant.reduce((sum, allocation) => sum + allocation.amountCents, 0);

				return { ...donation, amountCents, projects };
			})
		);

		const withAllocations = scoped.filter(
			(donation): donation is NonNullable<typeof donation> => donation !== null
		);

		return {
			donations: withAllocations,
			totalCents: withAllocations.reduce((sum, donation) => sum + donation.amountCents, 0)
		};
	}
});

/**
 * This contact's involvement in one campaign: their campaign-level
 * membership(s), if any, plus the campaign's own projects they are linked to
 * via projectMembers, with their role on each. Reuses the same two sources
 * listCampaignMembers derives membership from, just narrowed to one contact
 * instead of aggregated across all of them.
 */
export const getCampaignInvolvement = query({
	args: { contactId: v.id('contacts'), campaignId: v.id('campaigns') },
	handler: async (ctx, args) => {
		// Scoped to the campaign being asked about, not the bare capability: this
		// query names a campaign, so a leader assigned elsewhere must not be able
		// to read who is involved in it.
		const access = await getAccess(ctx);
		if (!access.orgId || !can(access, 'contacts:read', args.campaignId)) {
			return { memberships: [], projects: [] };
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== access.orgId) {
			return { memberships: [], projects: [] };
		}

		const contact = await ctx.db.get('contacts', args.contactId);
		if (!contact || contact.orgId !== access.orgId) {
			return { memberships: [], projects: [] };
		}

		const membershipRows = await ctx.db
			.query('campaignMemberships')
			.withIndex('by_campaignId_and_contactId', (q) =>
				q.eq('campaignId', args.campaignId).eq('contactId', args.contactId)
			)
			.collect();
		const memberships = membershipRows.filter((row) => row.orgId === access.orgId);

		const projectLinks = await ctx.db
			.query('projectMembers')
			.withIndex('by_contactId', (q) => q.eq('contactId', args.contactId))
			.collect();

		const withProjects = await Promise.all(
			projectLinks
				.filter((link) => link.orgId === access.orgId)
				.map(async (link) => ({
					role: link.role,
					project: await ctx.db.get('projects', link.projectId)
				}))
		);

		// Only this campaign's own records — a contact linked to records in other
		// campaigns has no business showing up on this tab.
		const projects = withProjects.filter(
			(row) =>
				row.project !== null &&
				row.project.orgId === access.orgId &&
				row.project.campaignId === args.campaignId
		);

		return { memberships, projects };
	}
});
