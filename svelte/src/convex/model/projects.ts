import { ConvexError } from 'convex/values';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { PipelineStage } from '../../lib/domain/stages';
import { defaultStageKey } from '../../lib/domain/stages';

export type ProjectAttributeValue = string | number | boolean | null;

export type CreateProjectInput = {
	orgId: string;
	campaignId: Id<'campaigns'>;
	name: string;
	publicName?: string;
	number?: string;
	stage?: string;
	story?: string;
	attributes?: Record<string, ProjectAttributeValue>;
	note?: string;
	managedMissionsLink?: string;
	whatsappPhone?: string;
	siteRef?: string;
	photoUrl?: string;
	videoUrl?: string;
	isPublished?: boolean;
	isGoalMet?: boolean;
};

/** The pipelineStages rows of a campaign, in `order`, as the domain-helper shape. */
export async function campaignStages(
	ctx: MutationCtx,
	campaignId: Id<'campaigns'>
): Promise<PipelineStage[]> {
	const rows = await ctx.db
		.query('pipelineStages')
		.withIndex('by_campaignId_and_order', (q) => q.eq('campaignId', campaignId))
		.collect();

	return rows.map((row: Doc<'pipelineStages'>) => ({
		key: row.key,
		label: row.label,
		order: row.order,
		kind: row.kind,
		accent: row.accent ?? null,
		isDefault: row.isDefault,
		isFundedGate: row.isFundedGate,
		isSystem: row.isSystem
	}));
}

/**
 * Next display number for a campaign, e.g. P-031. Convex mutations are
 * serializable transactions, so a max+1 scan needs no counter row.
 */
async function nextProjectNumber(ctx: MutationCtx, campaign: Doc<'campaigns'>): Promise<string> {
	const projects = await ctx.db
		.query('projects')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
		.collect();

	const prefix = `${campaign.numberPrefix}-`;
	let highest = 0;
	for (const project of projects) {
		if (!project.number.startsWith(prefix)) {
			continue;
		}
		const suffix = project.number.slice(prefix.length);
		if (!/^\d+$/.test(suffix)) {
			continue;
		}
		highest = Math.max(highest, Number(suffix));
	}

	return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}

/**
 * Creates a project inside a campaign the caller's org owns. Shared by the
 * authed mutation and any seed, so both produce an identically-defaulted row.
 */
export async function createProjectModel(
	ctx: MutationCtx,
	input: CreateProjectInput
): Promise<Id<'projects'>> {
	const campaign = await ctx.db.get('campaigns', input.campaignId);
	if (!campaign || campaign.orgId !== input.orgId) {
		throw new ConvexError('Campaign not found');
	}

	const number = input.number ?? (await nextProjectNumber(ctx, campaign));

	// unique(orgId, number) — Convex has no unique constraints.
	const conflict = await ctx.db
		.query('projects')
		.withIndex('by_orgId_and_number', (q) => q.eq('orgId', input.orgId).eq('number', number))
		.first();
	if (conflict) {
		throw new ConvexError(`Project number already in use: ${number}`);
	}

	const stages = await campaignStages(ctx, input.campaignId);
	if (input.stage !== undefined && !stages.some((s) => s.key === input.stage)) {
		throw new ConvexError(`Invalid stage: ${input.stage}`);
	}
	const stage = input.stage ?? defaultStageKey(stages);

	return await ctx.db.insert('projects', {
		orgId: input.orgId,
		campaignId: input.campaignId,
		number,
		name: input.name,
		publicName: input.publicName?.trim() || undefined,
		stage,
		story: input.story,
		attributes: input.attributes ?? {},
		note: input.note,
		managedMissionsLink: input.managedMissionsLink,
		whatsappPhone: input.whatsappPhone,
		siteRef: input.siteRef,
		photoUrl: input.photoUrl,
		videoUrl: input.videoUrl,
		isPublished: input.isPublished ?? false,
		isGoalMet: input.isGoalMet ?? false
	});
}
