import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { deleteUpdateAssets } from './updates';
import { deleteConversationCascade, deleteProjectCheckins } from './checkins';

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

	// Check-ins go BEFORE the posts below, not after. A machine-drafted post
	// names the conversation it came from, and that cascade clears the link on a
	// draft it expects to still exist — running it after the posts were deleted
	// would leave it patching a row that is gone.
	await deleteProjectCheckins(ctx, projectId);

	// Posts about this record go with it, and their PHOTOGRAPHS GO FIRST: once
	// the row is gone its assetIds are gone with it, and those ids are the only
	// handle anything has on the blobs. Deleting the blob is also the only way to
	// revoke a storage URL that has already been handed to a visitor — there is
	// no expiry — so this is what actually takes a published photo down.
	const updates = await ctx.db
		.query('updates')
		.withIndex('by_projectId_and_status_and_publishedAt', (q) => q.eq('projectId', projectId))
		.collect();
	for (const update of updates) {
		await deleteUpdateAssets(ctx, update.assetIds);
		await ctx.db.delete('updates', update._id);
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

	// The trip link goes, and unlike the allocation above it is DELETED rather
	// than cleared: a link to a record that no longer exists carries no value,
	// where an allocation still carries the money that moved. The trip itself
	// survives — it visited other records, and it happened.
	const tripLinks = await ctx.db
		.query('tripProjects')
		.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
		.collect();
	for (const link of tripLinks) {
		await ctx.db.delete('tripProjects', link._id);
	}

	await ctx.db.delete('projects', projectId);
}

/**
 * Segments FIRST, then attendees. A per-person leg names the attendee it
 * belongs to, so removing the traveller first would leave a flight pointing at
 * nobody — and the arrival list the coordinator drives to the airport with is
 * built from exactly those rows.
 *
 * Everything else here is trip-owned and goes with it: the record links, the
 * planned budget, and the checklist. Once §7's ledger integration lands this
 * also CLEARS `allocations.tripId` — never deletes the row, for the same reason
 * deleteProjectCascade clears `projectId`: the money still moved, it simply
 * stops being trip-attributed.
 */
export async function deleteTripCascade(ctx: MutationCtx, tripId: Id<'trips'>): Promise<void> {
	const segments = await ctx.db
		.query('tripSegments')
		.withIndex('by_tripId', (q) => q.eq('tripId', tripId))
		.collect();
	for (const segment of segments) {
		await ctx.db.delete('tripSegments', segment._id);
	}

	// Only the link rows go; the travellers themselves are org-level people.
	const attendees = await ctx.db
		.query('tripAttendees')
		.withIndex('by_tripId', (q) => q.eq('tripId', tripId))
		.collect();
	for (const attendee of attendees) {
		await ctx.db.delete('tripAttendees', attendee._id);
	}

	const projectLinks = await ctx.db
		.query('tripProjects')
		.withIndex('by_tripId', (q) => q.eq('tripId', tripId))
		.collect();
	for (const link of projectLinks) {
		await ctx.db.delete('tripProjects', link._id);
	}

	// Planned costs only, and nothing else reads them, so they simply go.
	const budgetLines = await ctx.db
		.query('tripBudgetLines')
		.withIndex('by_tripId', (q) => q.eq('tripId', tripId))
		.collect();
	for (const line of budgetLines) {
		await ctx.db.delete('tripBudgetLines', line._id);
	}

	// The checklist goes with the trip, the same as a record's does in
	// deleteProjectCascade: it is a tick against a journey that no longer
	// exists. A task carrying BOTH tripId and projectId goes too — it was the
	// trip's work — and the record's own cascade would reach it anyway.
	const tasks = await ctx.db
		.query('tasks')
		.withIndex('by_tripId', (q) => q.eq('tripId', tripId))
		.collect();
	for (const task of tasks) {
		await ctx.db.delete('tasks', task._id);
	}

	await ctx.db.delete('trips', tripId);
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

	// An assignment is cleared for the same reason donor attribution above is:
	// the work is still the campaign's work, only the person is gone. Deleting
	// the task would erase a job that still has to be done — and, if it was
	// ticked and tagged, silently move a published number.
	//
	// A PER-ATTENDEE TRIP ITEM IS THE EXCEPTION, and is deleted instead. "Passport
	// valid 6 months past return" is not work that outlives the traveller: cleared,
	// it survives on the trip page as an orphan reading "Passport check —
	// Unassigned", which is a row nobody can ever tick and which makes the
	// readiness count wrong. Narrowed to template-sourced trip tasks on purpose —
	// those are the instantiated checklist, one row per person. A trip task
	// somebody TYPED and handed to this contact is real work, and it is cleared
	// like everything else.
	//
	// Read by org rather than by assignee: the field is optional and
	// polymorphic, so no index over it would be useful to anything else, and a
	// contact delete is rare enough not to earn one. The orgId prefix of
	// by_orgId_and_status keeps this bounded to the tenant.
	const assigned = await ctx.db
		.query('tasks')
		.withIndex('by_orgId_and_status', (q) => q.eq('orgId', contact.orgId))
		.collect();
	for (const task of assigned) {
		if (task.assignee?.kind !== 'contact' || task.assignee.contactId !== contactId) continue;
		if (task.tripId !== undefined && task.source === 'template') {
			await ctx.db.delete('tasks', task._id);
			continue;
		}
		await ctx.db.patch('tasks', task._id, { assignee: undefined });
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

	// A check-in names the person it is messaging. CLEARED, not cascaded, for
	// the same reason a transaction's contactId is: the conversation happened,
	// the transcript is the record of it, and it does not stop being evidence
	// because the person's row was deleted. What it stops being is deliverable —
	// which is the transport's problem, and the transport reads this column.
	const checkins = await ctx.db
		.query('checkinConversations')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.take(100);
	for (const checkin of checkins) {
		await ctx.db.patch('checkinConversations', checkin._id, { contactId: undefined });
	}

	const projectLinks = await ctx.db
		.query('projectMembers')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	for (const link of projectLinks) {
		await ctx.db.delete('projectMembers', link._id);
	}

	// Same order as deleteTripCascade and for the same reason: this person's own
	// flight legs name their attendee row, so they go before it. The trip itself
	// survives — it still happened, and the rest of the team still went.
	const tripLinks = await ctx.db
		.query('tripAttendees')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	for (const link of tripLinks) {
		const segments = await ctx.db
			.query('tripSegments')
			.withIndex('by_attendeeId', (q) => q.eq('attendeeId', link._id))
			.collect();
		for (const segment of segments) {
			await ctx.db.delete('tripSegments', segment._id);
		}
		await ctx.db.delete('tripAttendees', link._id);
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

	// Tasks go by campaignId, NOT by project. A campaign-level task carries no
	// projectId at all, so the per-project cascade below can never reach it and
	// it would outlive the campaign that gave it meaning. Doing it here also
	// means that cascade finds nothing left, the same as the allocations above.
	const tasks = await ctx.db
		.query('tasks')
		.withIndex('by_campaignId_and_status', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const task of tasks) {
		await ctx.db.delete('tasks', task._id);
	}

	// Updates go by campaignId for the same reason tasks do: a campaign-level
	// post carries no projectId at all, so the per-project cascade below could
	// never reach it. Every post's PHOTOGRAPHS GO BEFORE ITS ROW — assetIds are
	// the only handle on those blobs, and deleting the blob is the only way to
	// revoke a storage URL already handed out. Doing it here also means the
	// project cascade finds nothing left, as with the allocations above.
	const updates = await ctx.db
		.query('updates')
		.withIndex('by_campaignId_and_status_and_publishedAt', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const update of updates) {
		await deleteUpdateAssets(ctx, update.assetIds);
		await ctx.db.delete('updates', update._id);
	}

	// Trips go BEFORE the projects below, the same shape as the allocations and
	// tasks above: each takes its own record links with it, so the per-project
	// cascade finds no tripProjects rows left to delete. The task sweep above
	// has already reached this campaign's trip tasks, so deleteTripCascade finds
	// none of those either — which is the pattern, not an oversight.
	const trips = await ctx.db
		.query('trips')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const trip of trips) {
		await deleteTripCascade(ctx, trip._id);
	}

	// The campaign's budget presets. Not reached by deleteTripCascade and never
	// could be: a preset belongs to the campaign, not to any trip, and a trip
	// holds a COPY of its lines rather than a reference. So this is the only
	// thing that deletes them, and without it they outlive the campaign.
	const budgetTemplates = await ctx.db
		.query('tripBudgetTemplates')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const template of budgetTemplates) {
		await ctx.db.delete('tripBudgetTemplates', template._id);
	}

	// Conversations that name a PERSON rather than a record — a sponsor, an
	// attendee — hang off the campaign alone, so the per-project cascade below
	// can never reach them. Same shape as the tasks and updates sweeps above,
	// and for the same reason: without it they outlive the campaign that gave
	// them meaning. Record-bound ones are left to deleteProjectCascade, which
	// finds them by projectId.
	const conversations = await ctx.db
		.query('checkinConversations')
		.withIndex('by_campaignId_and_status', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const conversation of conversations) {
		await deleteConversationCascade(ctx, conversation._id);
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

	// The campaign's workflows and every version they published. Nothing else
	// reaches these and nothing else could: a workflow belongs to the campaign,
	// and a run holds an id INTO a version rather than the other way round — so
	// without this sweep both outlive the campaign that owned them. The old
	// checkinTemplates/updateFormats rows had exactly this gap and it went
	// unnoticed because nothing ever read them back.
	//
	// Versions go with the workflow rather than being kept for replay: the runs
	// that named them are deleted a few lines above, by the conversation cascade
	// this same function already ran. A version whose every run is gone is not
	// an audit trail, it is a row nobody can reach.
	const workflowVersions = await ctx.db
		.query('workflowVersions')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const version of workflowVersions) {
		await ctx.db.delete('workflowVersions', version._id);
	}

	const campaignWorkflows = await ctx.db
		.query('workflows')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaignId))
		.collect();
	for (const workflow of campaignWorkflows) {
		await ctx.db.delete('workflows', workflow._id);
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
