import { ConvexError, v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireCapability } from '../model/access';
import { assertNonNegativeCents } from '../model/money';

// Planned costs only. Nothing in this file touches `transactions` or
// `allocations` — a trip budget is trip-owned data that nothing else reads or
// writes, which is exactly why it can be built in full while the ledger side is
// being worked on elsewhere. See PLAN-trips.md §7.

async function requireTrip(
	ctx: MutationCtx,
	orgId: string,
	tripId: Id<'trips'>
): Promise<Doc<'trips'>> {
	const trip = await ctx.db.get('trips', tripId);
	if (!trip || trip.orgId !== orgId) {
		throw new ConvexError('Trip not found');
	}
	return trip;
}

/** The line, its trip, and the write gate, resolved in one place. */
async function requireLine(
	ctx: MutationCtx,
	orgId: string,
	lineId: Id<'tripBudgetLines'>
): Promise<Doc<'tripBudgetLines'>> {
	const line = await ctx.db.get('tripBudgetLines', lineId);
	if (!line || line.orgId !== orgId) {
		throw new ConvexError('Budget line not found');
	}
	const trip = await requireTrip(ctx, orgId, line.tripId);
	await requireCapability(ctx, 'projects:write', trip.campaignId);
	return line;
}

export const createTripBudgetLine = mutation({
	args: {
		tripId: v.id('trips'),
		label: v.string(),
		amountCents: v.number(),
		// True when the amount is PER PERSON and the line total is amount x
		// roster. Airfare is quoted per seat and lodging per bed; a planner
		// multiplying by hand gets it wrong the first time somebody joins.
		perAttendee: v.optional(v.boolean()),
		notes: v.optional(v.string()),
		// Absent appends. The list is a handful of lines per trip, so reading it
		// to find the end is cheaper than asking every caller to compute one.
		order: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const trip = await requireTrip(ctx, orgId, args.tripId);
		await requireCapability(ctx, 'projects:write', trip.campaignId);

		// Integer cents, always — the rule the whole ledger follows. A planned
		// figure may be zero (a donated seat is still a line worth listing), so
		// this is the non-negative check and not the positive one.
		assertNonNegativeCents('amountCents', args.amountCents);

		let order = args.order;
		if (order === undefined) {
			const last = await ctx.db
				.query('tripBudgetLines')
				.withIndex('by_tripId_and_order', (q) => q.eq('tripId', trip._id))
				.order('desc')
				.first();
			order = last ? last.order + 1 : 0;
		}

		return await ctx.db.insert('tripBudgetLines', {
			orgId,
			tripId: trip._id,
			label: args.label,
			amountCents: args.amountCents,
			perAttendee: args.perAttendee ?? false,
			notes: args.notes?.trim() || undefined,
			order
		});
	}
});

// tripId is deliberately absent — a line belongs to the budget it was planned
// for. Moving one to another trip is a delete and a create.
export const updateTripBudgetLine = mutation({
	args: {
		lineId: v.id('tripBudgetLines'),
		label: v.optional(v.string()),
		amountCents: v.optional(v.number()),
		perAttendee: v.optional(v.boolean()),
		// null (or a blank string) clears the note.
		notes: v.optional(v.union(v.string(), v.null())),
		order: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const line = await requireLine(ctx, orgId, args.lineId);

		const patch: Partial<Doc<'tripBudgetLines'>> = {};
		if (args.label !== undefined) patch.label = args.label;
		if (args.amountCents !== undefined) {
			assertNonNegativeCents('amountCents', args.amountCents);
			patch.amountCents = args.amountCents;
		}
		if (args.perAttendee !== undefined) patch.perAttendee = args.perAttendee;
		if (args.notes !== undefined) patch.notes = args.notes?.trim() || undefined;
		if (args.order !== undefined) patch.order = args.order;

		await ctx.db.patch('tripBudgetLines', line._id, patch);
		return line._id;
	}
});

export const deleteTripBudgetLine = mutation({
	args: {
		lineId: v.id('tripBudgetLines')
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const line = await requireLine(ctx, orgId, args.lineId);

		await ctx.db.delete('tripBudgetLines', line._id);
		return null;
	}
});

/**
 * Drag-to-reorder, as one write per line in one transaction. Renumbering by
 * position rather than trusting the caller's numbers keeps the sequence dense,
 * so a later insert-at-end has somewhere to go.
 */
export const reorderTripBudgetLines = mutation({
	args: {
		tripId: v.id('trips'),
		lineIds: v.array(v.id('tripBudgetLines'))
	},
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const trip = await requireTrip(ctx, orgId, args.tripId);
		await requireCapability(ctx, 'projects:write', trip.campaignId);

		for (const [index, lineId] of args.lineIds.entries()) {
			const line = await ctx.db.get('tripBudgetLines', lineId);
			// A line from another trip in the list would reorder a budget the
			// caller never named.
			if (!line || line.orgId !== orgId || line.tripId !== trip._id) {
				throw new ConvexError('Budget line not found');
			}
			await ctx.db.patch('tripBudgetLines', line._id, { order: index });
		}

		return null;
	}
});

/**
 * Start this trip's budget from one of the campaign's presets.
 *
 * APPENDS, never replaces. A planner who has already typed two lines and then
 * reaches for a preset means "and the usual ones too" — wiping their work
 * would be the destructive reading of an additive-sounding action, and it is
 * not recoverable through undo. Applying twice therefore duplicates, which is
 * visible and one delete away; the alternative failure is silent.
 *
 * The lines are COPIED, which is the whole reason `tripBudgetTemplates` needs
 * no versioning: from here on the trip owns its rows, and editing the preset
 * later cannot reach them. See the note on that table in schema.ts.
 */
export const applyTripBudgetTemplate = mutation({
	args: { tripId: v.id('trips'), templateId: v.id('tripBudgetTemplates') },
	handler: async (ctx, args) => {
		const { orgId } = await requireCapability(ctx, 'projects:write');
		const trip = await requireTrip(ctx, orgId, args.tripId);
		await requireCapability(ctx, 'projects:write', trip.campaignId);

		const template = await ctx.db.get('tripBudgetTemplates', args.templateId);
		if (!template || template.orgId !== orgId) throw new ConvexError('Template not found');
		// A preset belongs to the campaign that wrote it. Applying another
		// campaign's would price this trip off a rate card its planners cannot
		// see, and quietly leak what that campaign spends.
		if (template.campaignId !== trip.campaignId) throw new ConvexError('Template not found');

		const existing = await ctx.db
			.query('tripBudgetLines')
			.withIndex('by_tripId', (q) => q.eq('tripId', trip._id))
			.collect();
		// Appended after whatever is already there, so existing rows keep their
		// order and the new ones arrive in the preset's own sequence.
		let order = existing.reduce((max, line) => Math.max(max, line.order + 1), 0);

		const lines = [...template.lines].sort((a, b) => a.order - b.order);
		for (const line of lines) {
			assertNonNegativeCents(line.label, line.amountCents);
			await ctx.db.insert('tripBudgetLines', {
				orgId,
				tripId: trip._id,
				label: line.label,
				amountCents: line.amountCents,
				perAttendee: line.perAttendee,
				notes: line.notes,
				order
			});
			order += 1;
		}

		return lines.length;
	}
});
