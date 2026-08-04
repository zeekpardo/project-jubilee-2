import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAccess } from '../model/access';
import { can } from '../../lib/domain/permissions';

/**
 * What a trip PLANS to spend, in the order the planner arranged it.
 *
 * Planned only. Actuals live in the ledger and the `allocations.tripId` that
 * would attribute them is specified but not built — nothing here reads
 * `transactions` or `allocations`, deliberately. See PLAN-trips.md §7.
 *
 * The per-person subtotal and the trip total are NOT computed here: a line
 * marked perAttendee multiplies by the roster, so the arithmetic belongs in the
 * pure lib/domain/trip-budget.ts where it can be tested and re-run as the
 * roster moves.
 */
export const listTripBudgetLines = query({
	args: {
		tripId: v.id('trips')
	},
	handler: async (ctx, args) => {
		const access = await getAccess(ctx);
		if (!access.orgId) {
			return [];
		}

		const trip = await ctx.db.get('trips', args.tripId);
		if (!trip || trip.orgId !== access.orgId) {
			return [];
		}
		if (!can(access, 'projects:read', trip.campaignId)) {
			return [];
		}

		// by_tripId_and_order, so the Money block reads in index order rather than
		// sorting in the handler.
		return await ctx.db
			.query('tripBudgetLines')
			.withIndex('by_tripId_and_order', (q) => q.eq('tripId', trip._id))
			.collect();
	}
});
