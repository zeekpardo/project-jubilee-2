// Authoring a campaign's trip budget presets.
//
// Unversioned by design — see the note on `tripBudgetTemplates` in schema.ts.
// Applying a preset copies its lines onto a trip, so a trip never references
// the preset it came from and editing one later cannot reach a trip that
// already used it. That is what makes plain edit-in-place safe here, where
// `costTemplates` and `taskTemplates` both need append-only versions.

import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireCapability } from '../model/access';
import { assertNonNegativeCents } from '../model/money';

const linesValidator = v.array(
	v.object({
		label: v.string(),
		amountCents: v.number(),
		perAttendee: v.boolean(),
		notes: v.optional(v.string()),
		order: v.number()
	})
);

async function requireCampaign(
	ctx: MutationCtx,
	orgId: string,
	campaignId: Id<'campaigns'>
): Promise<Doc<'campaigns'>> {
	const campaign = await ctx.db.get('campaigns', campaignId);
	if (!campaign || campaign.orgId !== orgId) throw new ConvexError('Campaign not found');
	return campaign;
}

async function requireTemplate(
	ctx: MutationCtx,
	orgId: string,
	templateId: Id<'tripBudgetTemplates'>
): Promise<Doc<'tripBudgetTemplates'>> {
	const template = await ctx.db.get('tripBudgetTemplates', templateId);
	if (!template || template.orgId !== orgId) throw new ConvexError('Template not found');
	return template;
}

/**
 * Integer, non-negative cents — the shared ledger rule, reused rather than
 * restated so a preset cannot accept an amount the budget line it becomes
 * would reject.
 */
function assertWholeCents(lines: { amountCents: number; label: string }[]): void {
	for (const line of lines) {
		assertNonNegativeCents(line.label || 'Amount', line.amountCents);
	}
}

export const createTripBudgetTemplate = mutation({
	args: { campaignId: v.id('campaigns'), name: v.string(), lines: linesValidator },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write', args.campaignId);
		await requireCampaign(ctx, orgId, args.campaignId);

		const name = args.name.trim();
		if (!name) throw new ConvexError('A preset needs a name');
		assertWholeCents(args.lines);

		return await ctx.db.insert('tripBudgetTemplates', {
			orgId,
			campaignId: args.campaignId,
			name,
			lines: args.lines
		});
	}
});

export const updateTripBudgetTemplate = mutation({
	args: {
		templateId: v.id('tripBudgetTemplates'),
		name: v.optional(v.string()),
		lines: v.optional(linesValidator)
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const template = await requireTemplate(ctx, orgId, args.templateId);
		await requireCapability(ctx, 'projects:write', template.campaignId);

		const patch: Partial<Doc<'tripBudgetTemplates'>> = {};
		if (args.name !== undefined) {
			const name = args.name.trim();
			if (!name) throw new ConvexError('A preset needs a name');
			patch.name = name;
		}
		if (args.lines !== undefined) {
			assertWholeCents(args.lines);
			patch.lines = args.lines;
		}

		await ctx.db.patch('tripBudgetTemplates', args.templateId, patch);
		return args.templateId;
	}
});

export const deleteTripBudgetTemplate = mutation({
	args: { templateId: v.id('tripBudgetTemplates') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const template = await requireTemplate(ctx, orgId, args.templateId);
		await requireCapability(ctx, 'projects:write', template.campaignId);

		// Nothing to cascade: trips hold COPIES of the lines, never a reference.
		await ctx.db.delete('tripBudgetTemplates', args.templateId);
		return null;
	}
});
