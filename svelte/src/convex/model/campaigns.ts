import { ConvexError } from 'convex/values';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { DEFAULT_PIPELINE_STAGES } from '../../lib/domain/campaign-defaults';

export function slugify(value: string): string {
	const slug = value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (!slug) {
		throw new ConvexError('Label must contain at least one alphanumeric character');
	}
	return slug;
}

export type CreateCampaignInput = {
	orgId: string;
	name: string;
	slug: string;
	objectLabel: string;
	objectLabelPlural: string;
	goalLabel: string;
	goalVerb: string;
	status?: 'active' | 'paused' | 'archived';
	numberPrefix?: string;
	theme?: string;
	summary?: string;
	story?: string;
	coverImageUrl?: string;
	iconUrl?: string;
	promoVideoUrl?: string;
	accent?: string;
	membersEnabled?: boolean;
	budgetShape?: 'flat' | 'template' | 'none';
	goalTrigger?: 'manual' | 'stage' | 'task';
	isPublished?: boolean;
};

/**
 * Creates a campaign and seeds its own copy of the default pipeline stages.
 * Shared by the authed mutation and the seed script, so both produce an
 * identically-configured campaign.
 */
export async function createCampaignModel(
	ctx: MutationCtx,
	input: CreateCampaignInput
): Promise<Id<'campaigns'>> {
	const existing = await ctx.db
		.query('campaigns')
		.withIndex('by_orgId_and_slug', (q) => q.eq('orgId', input.orgId).eq('slug', input.slug))
		.first();
	if (existing) {
		throw new ConvexError('Campaign slug already in use');
	}

	const campaignId = await ctx.db.insert('campaigns', {
		orgId: input.orgId,
		name: input.name,
		slug: input.slug,
		status: input.status ?? 'active',
		numberPrefix: input.numberPrefix ?? 'P',
		objectLabel: input.objectLabel,
		objectLabelPlural: input.objectLabelPlural,
		// Frozen at creation: renaming objectLabelPlural must never change public URLs.
		objectSlug: slugify(input.objectLabelPlural),
		theme: input.theme,
		summary: input.summary,
		story: input.story,
		coverImageUrl: input.coverImageUrl,
		iconUrl: input.iconUrl,
		promoVideoUrl: input.promoVideoUrl,
		accent: input.accent,
		membersEnabled: input.membersEnabled ?? true,
		budgetShape: input.budgetShape ?? 'template',
		goalLabel: input.goalLabel,
		goalVerb: input.goalVerb,
		goalTrigger: input.goalTrigger ?? 'manual',
		isPublished: input.isPublished ?? false,
		attributes: {}
	});

	for (const stage of DEFAULT_PIPELINE_STAGES) {
		await ctx.db.insert('pipelineStages', {
			orgId: input.orgId,
			campaignId,
			key: stage.key,
			label: stage.label,
			order: stage.order,
			kind: stage.kind,
			accent: stage.accent,
			isDefault: stage.isDefault,
			isFundedGate: stage.isFundedGate,
			isSystem: stage.isSystem
		});
	}

	return campaignId;
}
