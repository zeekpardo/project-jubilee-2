// Pure trip-budget math — no db imports. PLAN-trips.md §7.
//
// A trip budget is a FLAT LIST of labeled lines ("Airfare", "Lodging", "Visas"),
// each an integer-cent amount that is either a whole-trip cost or a PER SEAT
// cost multiplied by the confirmed roster. That is the entire model. It is
// deliberately NOT the project budget shape (templateSnapshot + debtCents +
// extras) that `budget-actuals.ts` reconciles, and §7 point 4 says so
// explicitly: trip actuals are the strictly simpler problem, so this module
// takes exactly two things from that one and writes the rest fresh —
//
//   1. the pure-function-with-no-db-imports shape, and
//   2. the synthetic "Unassigned" row that untagged expenditure allocations
//      roll into, so the panel still reconciles with every cent spent.
//
// Integer cents throughout; the only division in this file is the display
// `ratio`, which is explicitly a float and never money.
//
// Nothing here reads `allocations` — §7 keeps the ledger integration out of
// this worktree. `buildTripBudget` accepts the allocation rows a future
// `by_tripId` query will hand it, which is why the actuals panel ships as an
// empty state today and becomes a data-source swap later, not a redesign.

/** Synthetic ledger key for trip allocations with no (or no matching) budgetItem. */
export const UNASSIGNED_TRIP_BUDGET_ITEM = 'unassigned';

/** A `tripBudgetLines` row, reduced to what the math needs. */
export interface TripBudgetLine {
	/** Free text, and the key allocations tag themselves with. */
	label: string;
	/** Integer cents. PER SEAT when `perAttendee`, otherwise the whole cost. */
	amountCents: number;
	/** True when the line total is amount x confirmed roster. */
	perAttendee: boolean;
	order: number;
}

/**
 * One expenditure allocation attributed to the trip. Same minimal shape
 * `budget-actuals.ts` uses — `{ budgetItem, amountCents }` is the right shape,
 * it is only what it reconciles AGAINST that differs.
 */
export interface TripActualAllocation {
	budgetItem: string | null;
	amountCents: number;
}

/**
 * A stored tag as a ledger key. `budgetItem` is `v.optional(v.string())` and
 * the allocation form can persist an empty string, so `undefined` and `''` both
 * mean "untagged" — the domain's `null`.
 */
export function normalizeTripBudgetItem(budgetItem: string | null | undefined): string | null {
	const trimmed = budgetItem?.trim();
	return trimmed ? trimmed : null;
}

/**
 * A roster count as a non-negative integer. A trip with zero confirmed
 * attendees is a real state (the budget is drafted before anyone is confirmed),
 * and a per-seat line correctly plans to zero there rather than to its per-seat
 * quote.
 */
export function normalizeAttendeeCount(count: number): number {
	if (!Number.isFinite(count)) return 0;
	return Math.max(0, Math.trunc(count));
}

/**
 * What one line actually costs: the quoted amount, times the roster when the
 * amount is per seat. Integer x integer, so the result is exact — the reason
 * §7 stores the per-seat quote and multiplies here instead of asking a planner
 * to multiply by hand and get it silently wrong the first time somebody joins.
 */
export function lineTotalCents(line: TripBudgetLine, attendeeCount: number): number {
	if (!line.perAttendee) return line.amountCents;
	return line.amountCents * normalizeAttendeeCount(attendeeCount);
}

/**
 * The per-seat subtotal: what ONE more attendee adds to the trip. This is the
 * "per-person subtotal" §7's Money block shows next to the trip total.
 *
 * Deliberately the sum of the per-seat QUOTES, not `total / roster`. The two
 * differ whenever a non-per-attendee line exists (one van rental does not get
 * cheaper per head as more people come), and the number a coordinator needs
 * when someone asks "can we bring one more" is the marginal one.
 */
export function perAttendeeAmountCents(lines: TripBudgetLine[]): number {
	let total = 0;
	for (const line of lines) if (line.perAttendee) total += line.amountCents;
	return total;
}

/** The whole-trip lines, which do not move when the roster does. */
export function fixedAmountCents(lines: TripBudgetLine[]): number {
	let total = 0;
	for (const line of lines) if (!line.perAttendee) total += line.amountCents;
	return total;
}

/** The planned trip total: fixed lines + per-seat lines x confirmed roster. */
export function plannedTotalCents(lines: TripBudgetLine[], attendeeCount: number): number {
	const count = normalizeAttendeeCount(attendeeCount);
	return fixedAmountCents(lines) + perAttendeeAmountCents(lines) * count;
}

export interface TripBudgetRow {
	/** The line's label, or `UNASSIGNED_TRIP_BUDGET_ITEM` for the synthetic row. */
	key: string;
	label: string;
	group: 'line' | 'unassigned';
	/**
	 * Unique across the ledger even if someone labels a line "Unassigned" —
	 * `group` is what disambiguates, so this is the safe `{#each}` key.
	 */
	rowId: string;
	perAttendee: boolean;
	/** The quoted amount: per seat when `perAttendee`. Always 0 on the synthetic row. */
	unitAmountCents: number;
	/** unitAmountCents x roster when per-seat, else unitAmountCents. */
	plannedCents: number;
	actualCents: number;
	/** actualCents - plannedCents (positive = overspent). */
	deltaCents: number;
	/** actualCents / plannedCents in [0, ∞), or null when planned is 0. */
	ratio: number | null;
	/** Count of contributing allocations. */
	proofCount: number;
	order: number;
}

export interface TripBudgetLedger {
	rows: TripBudgetRow[];
	/** The roster the per-seat lines were multiplied by, after normalization. */
	attendeeCount: number;
	/** Sum of the per-seat quotes — what one more attendee adds. */
	perAttendeeAmountCents: number;
	fixedAmountCents: number;
	totalPlannedCents: number;
	/** Always equals the sum of every allocation passed in. See `buildTripBudget`. */
	totalActualCents: number;
	/** planned - actual (positive = under budget / unspent). */
	remainingCents: number;
}

/**
 * Build the planned-vs-actual ledger for a trip: one row per budget line in
 * `order`, plus a trailing "Unassigned" row when any allocation could not be
 * matched to a line.
 *
 * Allocations are attributed in a SINGLE PASS through a label index rather than
 * re-scanned per row (which is how `budget-actuals.ts` does it). That is not a
 * style preference — it buys the invariant this panel needs:
 *
 *   totalActualCents === the sum of every allocation handed in, always.
 *
 * Row-at-a-time matching cannot hold that. Two lines both labeled "Airfare"
 * (free text, nothing stops it) would each claim the same allocations and the
 * total would over-count real money. Here the first line with a given label
 * wins and a duplicate simply shows zero actual, so every cent lands in exactly
 * one row.
 *
 * "Unassigned" therefore absorbs two cases, and both must show or the panel
 * stops reconciling: allocations with no `budgetItem` at all, and allocations
 * tagged with a label no line carries any more (someone renamed "Visas" to
 * "Visas & fees" after the money was spent). Matching is exact after trimming —
 * case-insensitive matching would look clever and then silently merge "Lodging"
 * with a genuinely separate "lodging" line someone meant to keep apart.
 */
export function buildTripBudget(
	lines: TripBudgetLine[],
	allocations: TripActualAllocation[],
	attendeeCount: number,
	unassignedLabel = 'Unassigned'
): TripBudgetLedger {
	const count = normalizeAttendeeCount(attendeeCount);

	// [...].sort() rather than .toSorted() — toSorted is ES2023 and the Convex
	// tsc program (src/convex/tsconfig.json) pins lib to ES2021. Sort is stable,
	// so equal `order` values keep the caller's sequence.
	const ordered = [...lines].sort((a, b) => a.order - b.order);

	const actuals: number[] = ordered.map(() => 0);
	const proofs: number[] = ordered.map(() => 0);

	// First label wins; later duplicates are unreachable by tag, on purpose.
	const indexByLabel = new Map<string, number>();
	ordered.forEach((line, index) => {
		const key = normalizeTripBudgetItem(line.label);
		if (key !== null && !indexByLabel.has(key)) indexByLabel.set(key, index);
	});

	let unassignedActual = 0;
	let unassignedProof = 0;

	for (const allocation of allocations) {
		const tag = normalizeTripBudgetItem(allocation.budgetItem);
		const index = tag === null ? undefined : indexByLabel.get(tag);
		if (index === undefined) {
			unassignedActual += allocation.amountCents;
			unassignedProof += 1;
			continue;
		}
		actuals[index] += allocation.amountCents;
		proofs[index] += 1;
	}

	const rows: TripBudgetRow[] = ordered.map((line, index) => {
		const plannedCents = lineTotalCents(line, count);
		const actualCents = actuals[index];
		return {
			key: line.label,
			label: line.label,
			group: 'line',
			rowId: `line:${line.label}:${index}`,
			perAttendee: line.perAttendee,
			unitAmountCents: line.amountCents,
			plannedCents,
			actualCents,
			deltaCents: actualCents - plannedCents,
			ratio: plannedCents === 0 ? null : actualCents / plannedCents,
			proofCount: proofs[index],
			order: line.order
		};
	});

	// Never planned, but must show so the actual total ties out to every cent
	// attributed to the trip.
	if (unassignedProof > 0) {
		rows.push({
			key: UNASSIGNED_TRIP_BUDGET_ITEM,
			label: unassignedLabel,
			group: 'unassigned',
			rowId: `unassigned:${UNASSIGNED_TRIP_BUDGET_ITEM}`,
			perAttendee: false,
			unitAmountCents: 0,
			plannedCents: 0,
			actualCents: unassignedActual,
			deltaCents: unassignedActual,
			ratio: null,
			proofCount: unassignedProof,
			// Sorts last in any caller that re-sorts by order.
			order: Number.MAX_SAFE_INTEGER
		});
	}

	const totalPlannedCents = rows.reduce((sum, row) => sum + row.plannedCents, 0);
	const totalActualCents = rows.reduce((sum, row) => sum + row.actualCents, 0);

	return {
		rows,
		attendeeCount: count,
		perAttendeeAmountCents: perAttendeeAmountCents(ordered),
		fixedAmountCents: fixedAmountCents(ordered),
		totalPlannedCents,
		totalActualCents,
		remainingCents: totalPlannedCents - totalActualCents
	};
}
