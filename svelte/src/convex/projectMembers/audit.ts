// ============================================================
// The member-side audit — a report that writes nothing
// ============================================================
// `projectMembers.side` arrived after the rows did, and absent means `served`.
// Rows entered before it with roles like `volunteer` or `team_lead` are almost
// certainly the organization's own people, and they are being counted TODAY —
// in the campaign's published `people_reached`, and in the household size
// published on a family's public project page.
//
// PLAN-trips.md §13 is emphatic about how that gets corrected, and this module
// is that decision expressed as code: **a report, not a rewrite.** A
// @convex-dev/migrations job that applied the heuristic would move published
// impact numbers with nobody watching — precisely the failure `updates` and
// `publicStats` are both written to avoid. So the read side here writes
// nothing at all, and the write side takes explicit row ids, one campaign at a
// time, from an admin who has just been shown what the numbers become.
//
// It lives beside `mutations.ts` and `queries.ts` rather than inside them: this
// is a one-time correction surface with a heuristic in it, and it should be
// deletable in one file once the correction has been made everywhere.
//
// THE PROJECTED NUMBERS ARE NOT COMPUTED HERE. They come out of
// `model/stats.ts`'s own `evaluateStats`, run a second time with a read-only
// what-if overlay (`StatWhatIf`), so "12 becomes 9" is produced by the same
// engine the public site publishes from and cannot disagree with it. The one
// number this file does compute directly — a project's published household
// size — reuses `isPersonReachedRole`, which is the entire rule
// `model/public.ts` applies to build it.
//
// Gated on `settings:manage` throughout. Every other projects surface is
// campaign-scoped, but this one shows the consequences to published numbers
// across every campaign in the org, and the fix moves figures a donor has
// already seen. That is an org-admin decision, not a campaign one.
// ============================================================

import { v } from 'convex/values';
import { mutation, query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { readableOrgId, requireCapability } from '../model/access';
import { evaluateStats, type StatWhatIf } from '../model/stats';
import { isPersonReachedRole } from '../../lib/domain/campaign-stats';
import type { StatFormat } from '../../lib/domain/campaign-stats';
import { isMemberSideSuspect } from '../../lib/domain/member-side-audit';
import { contactDisplayName } from '../../lib/features/contacts/contact-name';

/** One row the heuristic proposes, with enough context for a human to judge it. */
export type MemberSideSuspect = {
	projectMemberId: Id<'projectMembers'>;
	projectId: Id<'projects'>;
	/** The record's own number and name — "which record is this?" */
	projectNumber: string;
	projectName: string;
	/** Whether that record's public page exists at all. */
	projectIsPublished: boolean;
	contactId: Id<'contacts'>;
	contactName: string;
	/** The raw text on the link. Shown verbatim: it is what was flagged. */
	role: string;
};

/** One configured stat, before and after the proposed correction. */
export type MemberSideStatDelta = {
	id: string;
	label: string;
	format: StatFormat;
	/** The internal figure — what the campaign dashboard shows. */
	before: number;
	after: number;
	/**
	 * What the public site shows, or null when it withholds this stat. Tracked
	 * separately because the correction can push a count under the small-count
	 * threshold, which is a stat DISAPPEARING from a donor page — a bigger
	 * change than the number moving, and invisible if only `before`/`after`
	 * were reported.
	 */
	publicBefore: number | null;
	publicAfter: number | null;
	showOnPublic: boolean;
	showOnDashboard: boolean;
};

/** One record's published household size, before and after. */
export type MemberSideHouseholdDelta = {
	projectId: Id<'projects'>;
	projectNumber: string;
	projectName: string;
	projectIsPublished: boolean;
	before: number;
	after: number;
};

/** A campaign with something to look at, for the picker. */
export type MemberSideAuditCampaign = {
	campaignId: Id<'campaigns'>;
	campaignName: string;
	campaignIsPublished: boolean;
	suspectCount: number;
};

export type MemberSideAuditReport = {
	campaignId: Id<'campaigns'>;
	campaignName: string;
	campaignIsPublished: boolean;
	suspects: MemberSideSuspect[];
	/** Exactly the rows the deltas below were computed for. */
	selectedMemberIds: Id<'projectMembers'>[];
	stats: MemberSideStatDelta[];
	households: MemberSideHouseholdDelta[];
};

/**
 * Every suspect row in one campaign, with its project.
 *
 * The same walk `loadMembers` takes — projects by campaign, links by project —
 * but over ALL projects, including those in stages excluded from impact: an
 * excluded record still publishes a household size, so a suspect row on one is
 * still worth showing.
 */
async function suspectRows(
	ctx: QueryCtx,
	campaign: Doc<'campaigns'>
): Promise<{ link: Doc<'projectMembers'>; project: Doc<'projects'> }[]> {
	const projects = await ctx.db
		.query('projects')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
		.collect();

	const out: { link: Doc<'projectMembers'>; project: Doc<'projects'> }[] = [];
	for (const project of projects) {
		const links = await ctx.db
			.query('projectMembers')
			.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
			.collect();
		for (const link of links) {
			if (isMemberSideSuspect(link)) out.push({ link, project });
		}
	}
	return out;
}

/**
 * The campaigns worth opening, and how many rows each has.
 *
 * Deliberately does NOT compute any stat: this is the picker, it runs for every
 * campaign in the org, and evaluating a campaign's whole stat selection twice
 * is the expensive part. A campaign with nothing to correct is omitted rather
 * than listed with a zero — an empty list is the report saying "nothing to do".
 */
export const listAuditCampaigns = query({
	args: {},
	handler: async (ctx): Promise<MemberSideAuditCampaign[]> => {
		const orgId = await readableOrgId(ctx, 'settings:manage');
		if (!orgId) {
			return [];
		}

		const campaigns = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.collect();

		const out: MemberSideAuditCampaign[] = [];
		for (const campaign of campaigns) {
			const rows = await suspectRows(ctx, campaign);
			if (rows.length === 0) continue;
			out.push({
				campaignId: campaign._id,
				campaignName: campaign.name,
				campaignIsPublished: campaign.isPublished,
				suspectCount: rows.length
			});
		}
		return out.sort((a, b) => a.campaignName.localeCompare(b.campaignName));
	}
});

/**
 * One campaign's report: the suspect rows, and what marking the SELECTED ones
 * as `team` would do to every number this campaign publishes.
 *
 * `selectedMemberIds` is what makes the before/after honest. The admin can
 * uncheck a row they know is a beneficiary, and the projection recomputes for
 * exactly what is still ticked rather than for a set that no longer matches
 * the button. Omitting it means "all of them", which is what the screen opens
 * on; an empty array is a real selection and correctly yields no delta at all.
 *
 * Reads only. Nothing here writes, and nothing here is cached against a later
 * write — the numbers are recomputed live from the rows as they stand.
 */
export const campaignAudit = query({
	args: {
		campaignId: v.id('campaigns'),
		selectedMemberIds: v.optional(v.array(v.id('projectMembers')))
	},
	handler: async (ctx, args): Promise<MemberSideAuditReport | null> => {
		const orgId = await readableOrgId(ctx, 'settings:manage');
		if (!orgId) {
			return null;
		}

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			return null;
		}

		const rows = await suspectRows(ctx, campaign);

		const suspects: MemberSideSuspect[] = [];
		for (const { link, project } of rows) {
			const contact = await ctx.db.get('contacts', link.contactId);
			suspects.push({
				projectMemberId: link._id,
				projectId: project._id,
				projectNumber: project.number,
				projectName: project.name,
				projectIsPublished: project.isPublished,
				contactId: link.contactId,
				// A link whose contact has been deleted still counts today, so it
				// is still worth listing; it just has no name to show.
				contactName: contact ? contactDisplayName(contact) : '',
				role: link.role
			});
		}

		// The selection, narrowed to rows that are actually on this report: an
		// id from a stale client, or from another campaign, must not silently
		// widen what the projection covers.
		const suspectIds = new Set(suspects.map((row) => row.projectMemberId as string));
		const selected = (args.selectedMemberIds ?? suspects.map((row) => row.projectMemberId)).filter(
			(id) => suspectIds.has(id as string)
		);
		const whatIf: StatWhatIf = { teamMemberIds: new Set(selected.map((id) => id as string)) };

		// The headline. Both sides come from the SAME engine the public site and
		// the dashboard read, so the projected figure cannot disagree with what
		// the site would actually publish afterwards.
		const before = await evaluateStats(ctx, campaign);
		const after = await evaluateStats(ctx, campaign, undefined, whatIf);
		const afterById = new Map(after.map((stat) => [stat.id, stat]));

		const stats: MemberSideStatDelta[] = [];
		for (const row of before) {
			const next = afterById.get(row.id);
			if (!next) continue;
			// Only the stats this actually moves. A campaign publishing eight
			// numbers of which one changes should show one row, not eight.
			if (row.value === next.value && row.publicValue === next.publicValue) continue;
			stats.push({
				id: row.id,
				label: row.label,
				format: row.format,
				before: row.value,
				after: next.value,
				publicBefore: row.publicValue,
				publicAfter: next.publicValue,
				showOnPublic: row.showOnPublic,
				showOnDashboard: row.showOnDashboard
			});
		}

		// The other published number, and the one §8 calls sharper than a wrong
		// statistic: `model/public.ts` builds a record's public `memberCount`
		// and its `memberFirstNames` from exactly this filter, so a trip goer on
		// a family's record is published as part of that household. Recomputed
		// with the same predicate rather than a count of ticked boxes, so a row
		// that a donor role already excludes cannot be double-counted here.
		const households: MemberSideHouseholdDelta[] = [];
		const affectedProjects = new Map<string, Doc<'projects'>>();
		for (const { link, project } of rows) {
			if (whatIf.teamMemberIds.has(link._id as string)) {
				affectedProjects.set(project._id as string, project);
			}
		}
		for (const project of affectedProjects.values()) {
			const links = await ctx.db
				.query('projectMembers')
				.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
				.collect();
			const counted = (side: (link: Doc<'projectMembers'>) => 'served' | 'team' | undefined) =>
				links.filter((link) => isPersonReachedRole(link.role, side(link))).length;

			households.push({
				projectId: project._id,
				projectNumber: project.number,
				projectName: project.name,
				projectIsPublished: project.isPublished,
				before: counted((link) => link.side),
				after: counted((link) =>
					whatIf.teamMemberIds.has(link._id as string) ? 'team' : link.side
				)
			});
		}
		households.sort((a, b) => a.projectNumber.localeCompare(b.projectNumber));

		return {
			campaignId: campaign._id,
			campaignName: campaign.name,
			campaignIsPublished: campaign.isPublished,
			suspects,
			selectedMemberIds: selected,
			stats,
			households
		};
	}
});

/**
 * Mark the named rows `side: 'team'`. The only write in this module.
 *
 * Explicit ids, never "apply the heuristic": the heuristic proposes and a
 * human disposes, and the ids are what the human ticked. Scoped to one
 * campaign — §13's unit of decision — and every id is checked to be in it, so
 * a stale or forged id cannot reach a record the admin was not looking at.
 *
 * Safe to re-run. A row already marked `team` is counted and skipped rather
 * than rewritten, so a double-click, a retry, or a second pass over the same
 * report costs nothing and changes nothing.
 *
 * It deliberately does NOT re-check the heuristic. An admin who has read the
 * report may know that an `attendee` row is their own staffer, and this
 * screen's whole purpose is to let a person answer what the code could not.
 */
export const markMembersAsTeam = mutation({
	args: {
		campaignId: v.id('campaigns'),
		projectMemberIds: v.array(v.id('projectMembers'))
	},
	handler: async (ctx, args): Promise<{ updated: number; alreadyTeam: number }> => {
		// Org-wide, with no campaignId: `settings:manage` is not campaign-scoped
		// and this surface is org-admin by design — see the header.
		const { orgId } = await requireCapability(ctx, 'settings:manage');

		const campaign = await ctx.db.get('campaigns', args.campaignId);
		if (!campaign || campaign.orgId !== orgId) {
			// Same posture as every other cross-org id: it does not exist here.
			return { updated: 0, alreadyTeam: 0 };
		}

		let updated = 0;
		let alreadyTeam = 0;
		for (const id of args.projectMemberIds) {
			const link = await ctx.db.get('projectMembers', id);
			if (!link || link.orgId !== orgId) continue;

			const project = await ctx.db.get('projects', link.projectId);
			if (!project || project.campaignId !== campaign._id) continue;

			if (link.side === 'team') {
				alreadyTeam += 1;
				continue;
			}
			await ctx.db.patch('projectMembers', link._id, { side: 'team' });
			updated += 1;
		}
		return { updated, alreadyTeam };
	}
});
