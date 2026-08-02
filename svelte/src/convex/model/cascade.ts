import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

/**
 * Convex has no foreign keys or ON DELETE CASCADE, so every dependent row must
 * be removed explicitly. These helpers are the single place that knows the
 * delete order, so a new child table only has to be handled once.
 */

export async function deleteProjectCascade(
	ctx: MutationCtx,
	projectId: Id<'projects'>
): Promise<void> {
	const budgets = await ctx.db
		.query('budgets')
		.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
		.collect();
	for (const budget of budgets) {
		await ctx.db.delete('budgets', budget._id);
	}

	// Only the link rows go; the contacts themselves are org-level people.
	const members = await ctx.db
		.query('projectMembers')
		.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
		.collect();
	for (const member of members) {
		await ctx.db.delete('projectMembers', member._id);
	}

	// The checklist goes with the record. Unlike allocations below, a task
	// carries no value once its project is gone: it is a tick against a record
	// that no longer exists, and leaving it would keep it in the impact counts.
	const tasks = await ctx.db
		.query('tasks')
		.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
		.collect();
	for (const task of tasks) {
		await ctx.db.delete('tasks', task._id);
	}

	const documents = await ctx.db
		.query('documents')
		.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
		.collect();
	for (const document of documents) {
		// Drop the uploaded blob too, or deleting a project leaks storage.
		if (document.storageId) {
			await ctx.storage.delete(document.storageId);
		}
		await ctx.db.delete('documents', document._id);
	}

	// Allocations are CLEARED, never deleted: the money still moved, so the
	// ledger total must survive. The allocation just becomes campaign-level.
	const allocations = await ctx.db
		.query('allocations')
		.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
		.collect();
	for (const allocation of allocations) {
		await ctx.db.patch('allocations', allocation._id, { projectId: undefined });
	}

	await ctx.db.delete('projects', projectId);
}

export async function deleteHouseholdCascade(
	ctx: MutationCtx,
	householdId: Id<'households'>
): Promise<void> {
	// Only the link rows go; the contacts themselves are org-level people.
	const members = await ctx.db
		.query('householdMembers')
		.withIndex('by_householdId', (q) => q.eq('householdId', householdId))
		.collect();
	for (const member of members) {
		await ctx.db.delete('householdMembers', member._id);
	}

	await ctx.db.delete('households', householdId);
}

export async function deleteContactCascade(
	ctx: MutationCtx,
	contactId: Id<'contacts'>
): Promise<void> {
	const contact = await ctx.db.get('contacts', contactId);
	if (!contact) return;

	// Donor attribution is cleared, never cascaded: the money still moved, so
	// the transaction and the ledger total have to survive.
	const transactions = await ctx.db
		.query('transactions')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	for (const transaction of transactions) {
		await ctx.db.patch('transactions', transaction._id, { contactId: undefined });
	}

	const householdLinks = await ctx.db
		.query('householdMembers')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	for (const link of householdLinks) {
		await ctx.db.delete('householdMembers', link._id);
	}

	const emails = await ctx.db
		.query('contactEmails')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	for (const email of emails) {
		await ctx.db.delete('contactEmails', email._id);
	}

	const phones = await ctx.db
		.query('contactPhones')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	for (const phone of phones) {
		await ctx.db.delete('contactPhones', phone._id);
	}

	const addresses = await ctx.db
		.query('contactAddresses')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	for (const address of addresses) {
		await ctx.db.delete('contactAddresses', address._id);
	}

	const backgroundChecks = await ctx.db
		.query('contactBackgroundChecks')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	for (const check of backgroundChecks) {
		await ctx.db.delete('contactBackgroundChecks', check._id);
	}

	const projectLinks = await ctx.db
		.query('projectMembers')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	for (const link of projectLinks) {
		await ctx.db.delete('projectMembers', link._id);
	}

	// A household outlives its primary contact; other members may remain.
	const households = await ctx.db
		.query('households')
		.withIndex('by_orgId', (q) => q.eq('orgId', contact.orgId))
		.collect();
	for (const household of households) {
		if (household.primaryContactId === contactId) {
			await ctx.db.patch('households', household._id, { primaryContactId: undefined });
		}
	}

	await ctx.db.delete('contacts', contactId);
}

export async function deleteCampaignCascade(
	ctx: MutationCtx,
	campaignId: Id<'campaigns'>
): Promise<void> {
	// Storage ids are the only handle to these blobs, so they must go before
	// the campaign row does or the upload leaks. Mirrors the document cleanup
	// in deleteProjectCascade below.
	const campaign = await ctx.db.get('campaigns', campaignId);
	if (campaign?.coverImageStorageId) {
		await ctx.storage.delete(campaign.coverImageStorageId);
	}
	if (campaign?.iconStorageId) {
		await ctx.storage.delete(campaign.iconStorageId);
	}

	// Allocations go first so the per-project clearing below finds nothing left
	// to do. Transactions themselves are org-level and survive: the money still
	// moved, it simply becomes unallocated.
	const allocations = await ctx.db
		.query('allocations')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const allocation of allocations) {
		await ctx.db.delete('allocations', allocation._id);
	}

	const projects = await ctx.db
		.query('projects')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const project of projects) {
		await deleteProjectCascade(ctx, project._id);
	}

	const stages = await ctx.db
		.query('pipelineStages')
		.withIndex('by_campaignId_and_order', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const stage of stages) {
		await ctx.db.delete('pipelineStages', stage._id);
	}

	const costs = await ctx.db
		.query('costTemplates')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const cost of costs) {
		await ctx.db.delete('costTemplates', cost._id);
	}

	const taskTemplates = await ctx.db
		.query('taskTemplates')
		.withIndex('by_campaignId_and_version', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const template of taskTemplates) {
		await ctx.db.delete('taskTemplates', template._id);
	}

	// The org's public page may name this campaign as a stats section. The
	// public read already skips a section whose campaign is gone, but leaving
	// the row would resurrect the section if a new campaign ever reused the id.
	if (campaign) {
		const settings = await ctx.db
			.query('orgSettings')
			.withIndex('by_orgId', (q) => q.eq('orgId', campaign.orgId))
			.unique();
		const sections = settings?.publicStatSections;
		if (settings && sections?.some((section) => section.campaignId === campaignId)) {
			await ctx.db.patch('orgSettings', settings._id, {
				publicStatSections: sections.filter((section) => section.campaignId !== campaignId)
			});
		}
	}

	await ctx.db.delete('campaigns', campaignId);
}
