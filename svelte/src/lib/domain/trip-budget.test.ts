import { describe, expect, it } from 'vitest';
import {
	buildTripBudget,
	fixedAmountCents,
	lineTotalCents,
	normalizeAttendeeCount,
	normalizeTripBudgetItem,
	perAttendeeAmountCents,
	plannedTotalCents,
	UNASSIGNED_TRIP_BUDGET_ITEM,
	type TripActualAllocation,
	type TripBudgetLine
} from './trip-budget';

// A December Islamabad trip for eight confirmed attendees. Airfare, lodging and
// visas are quoted per seat; the van and the group policy are not.
const lines: TripBudgetLine[] = [
	{ label: 'Airfare', amountCents: 145_000, perAttendee: true, order: 0 },
	{ label: 'Lodging', amountCents: 32_000, perAttendee: true, order: 1 },
	{ label: 'Ground transport', amountCents: 120_000, perAttendee: false, order: 2 },
	{ label: 'Visas', amountCents: 17_500, perAttendee: true, order: 3 },
	{ label: 'Insurance', amountCents: 90_000, perAttendee: false, order: 4 }
];

const ATTENDEES = 8;

// What a future `by_tripId` allocations query will hand the panel. Two rows
// cannot be matched: one was never tagged, one carries a label no line has.
const allocations: TripActualAllocation[] = [
	{ budgetItem: 'Airfare', amountCents: 700_000 },
	{ budgetItem: 'Airfare', amountCents: 480_000 }, // 1,180,000 vs 1,160,000 planned
	{ budgetItem: 'Ground transport', amountCents: 120_000 }, // exactly planned
	{ budgetItem: 'Visas', amountCents: 100_000 }, // under
	{ budgetItem: null, amountCents: 4_999 }, // untagged
	{ budgetItem: 'Baggage fees', amountCents: 2_501 } // tagged, but no such line
];

const sumOf = (rows: TripActualAllocation[]) => rows.reduce((n, r) => n + r.amountCents, 0);

describe('normalizeTripBudgetItem', () => {
	it('keeps a real tag and trims it so it still matches its line', () => {
		expect(normalizeTripBudgetItem('Airfare')).toBe('Airfare');
		expect(normalizeTripBudgetItem('  Lodging  ')).toBe('Lodging');
	});

	it('treats undefined, null, empty and whitespace-only as untagged', () => {
		expect(normalizeTripBudgetItem(undefined)).toBeNull();
		expect(normalizeTripBudgetItem(null)).toBeNull();
		expect(normalizeTripBudgetItem('')).toBeNull();
		expect(normalizeTripBudgetItem('   ')).toBeNull();
	});
});

describe('normalizeAttendeeCount', () => {
	it('floors to a non-negative integer', () => {
		expect(normalizeAttendeeCount(8)).toBe(8);
		expect(normalizeAttendeeCount(0)).toBe(0);
		expect(normalizeAttendeeCount(-3)).toBe(0);
		expect(normalizeAttendeeCount(7.9)).toBe(7);
		expect(normalizeAttendeeCount(Number.NaN)).toBe(0);
		expect(normalizeAttendeeCount(Number.POSITIVE_INFINITY)).toBe(0);
	});
});

describe('lineTotalCents', () => {
	it('multiplies a per-seat line by the confirmed roster', () => {
		expect(lineTotalCents(lines[0], ATTENDEES)).toBe(1_160_000);
		expect(lineTotalCents(lines[1], ATTENDEES)).toBe(256_000);
		expect(lineTotalCents(lines[3], ATTENDEES)).toBe(140_000);
	});

	it('leaves a whole-trip line alone', () => {
		expect(lineTotalCents(lines[2], ATTENDEES)).toBe(120_000);
		expect(lineTotalCents(lines[2], 0)).toBe(120_000);
		expect(lineTotalCents(lines[4], 100)).toBe(90_000);
	});

	it('plans a per-seat line to zero before anyone is confirmed', () => {
		expect(lineTotalCents(lines[0], 0)).toBe(0);
	});

	it('stays in integer cents', () => {
		const odd: TripBudgetLine = {
			label: 'Visas',
			amountCents: 17_501,
			perAttendee: true,
			order: 0
		};
		const total = lineTotalCents(odd, 3);
		expect(total).toBe(52_503);
		expect(Number.isInteger(total)).toBe(true);
	});
});

describe('subtotals', () => {
	it('sums the per-seat quotes — what one more attendee adds', () => {
		expect(perAttendeeAmountCents(lines)).toBe(194_500);
	});

	it('sums the whole-trip lines', () => {
		expect(fixedAmountCents(lines)).toBe(210_000);
	});

	it('is the marginal cost, not the total divided by the roster', () => {
		// 1,766,000 / 8 = 220,750 — larger than the marginal 194,500, because the
		// van and the policy do not get cheaper per head.
		const naive = plannedTotalCents(lines, ATTENDEES) / ATTENDEES;
		expect(naive).toBe(220_750);
		expect(perAttendeeAmountCents(lines)).not.toBe(naive);
	});

	it('totals fixed + per-seat x roster', () => {
		expect(plannedTotalCents(lines, ATTENDEES)).toBe(1_766_000);
		expect(210_000 + 194_500 * 8).toBe(1_766_000);
	});

	it('re-computes when the roster moves', () => {
		expect(plannedTotalCents(lines, 0)).toBe(210_000);
		expect(plannedTotalCents(lines, 1)).toBe(404_500);
		// One more attendee costs exactly the per-seat subtotal.
		expect(plannedTotalCents(lines, 9) - plannedTotalCents(lines, 8)).toBe(194_500);
	});

	it('handles an empty budget', () => {
		expect(perAttendeeAmountCents([])).toBe(0);
		expect(fixedAmountCents([])).toBe(0);
		expect(plannedTotalCents([], ATTENDEES)).toBe(0);
	});
});

describe('buildTripBudget', () => {
	const ledger = buildTripBudget(lines, allocations, ATTENDEES);

	it('emits a row per line, in order, plus an Unassigned row', () => {
		expect(ledger.rows).toHaveLength(6);
		expect(ledger.rows.map((row) => row.label)).toEqual([
			'Airfare',
			'Lodging',
			'Ground transport',
			'Visas',
			'Insurance',
			'Unassigned'
		]);
		expect(ledger.rows.filter((row) => row.group === 'unassigned')).toHaveLength(1);
	});

	it('sorts by order rather than trusting the caller', () => {
		const shuffled = [lines[3], lines[0], lines[4], lines[1], lines[2]];
		const sorted = buildTripBudget(shuffled, [], ATTENDEES);
		expect(sorted.rows.map((row) => row.label)).toEqual([
			'Airfare',
			'Lodging',
			'Ground transport',
			'Visas',
			'Insurance'
		]);
	});

	it('keeps the per-seat quote alongside the multiplied plan', () => {
		const airfare = ledger.rows[0];
		expect(airfare.perAttendee).toBe(true);
		expect(airfare.unitAmountCents).toBe(145_000);
		expect(airfare.plannedCents).toBe(1_160_000);

		const van = ledger.rows[2];
		expect(van.perAttendee).toBe(false);
		expect(van.unitAmountCents).toBe(120_000);
		expect(van.plannedCents).toBe(120_000);
	});

	it('computes actual, delta, ratio and proof per row', () => {
		const airfare = ledger.rows[0];
		expect(airfare.actualCents).toBe(1_180_000);
		expect(airfare.deltaCents).toBe(20_000); // overspent
		expect(airfare.ratio).toBeCloseTo(1.017_24, 5);
		expect(airfare.proofCount).toBe(2);

		const van = ledger.rows[2];
		expect(van.actualCents).toBe(120_000);
		expect(van.deltaCents).toBe(0);
		expect(van.ratio).toBe(1);
		expect(van.proofCount).toBe(1);
	});

	it('reports an unspent line as a negative delta', () => {
		const lodging = ledger.rows[1];
		expect(lodging.plannedCents).toBe(256_000);
		expect(lodging.actualCents).toBe(0);
		expect(lodging.deltaCents).toBe(-256_000);
		expect(lodging.ratio).toBe(0);
		expect(lodging.proofCount).toBe(0);
	});

	it('rolls untagged AND unknown-tag allocations into Unassigned', () => {
		const unassigned = ledger.rows[5];
		expect(unassigned.key).toBe(UNASSIGNED_TRIP_BUDGET_ITEM);
		expect(unassigned.group).toBe('unassigned');
		expect(unassigned.plannedCents).toBe(0);
		expect(unassigned.ratio).toBeNull();
		// 4,999 untagged + 2,501 tagged "Baggage fees", which no line carries.
		expect(unassigned.actualCents).toBe(7_500);
		expect(unassigned.proofCount).toBe(2);
	});

	it('reconciles with every cent attributed to the trip', () => {
		expect(ledger.totalActualCents).toBe(sumOf(allocations));
		expect(ledger.totalActualCents).toBe(1_407_500);
		expect(ledger.totalPlannedCents).toBe(1_766_000);
		expect(ledger.remainingCents).toBe(358_500);
		// Row actuals add back to the total — nothing is dropped or double-counted.
		expect(ledger.rows.reduce((n, r) => n + r.actualCents, 0)).toBe(sumOf(allocations));
	});

	it('carries the subtotals the Money block renders', () => {
		expect(ledger.attendeeCount).toBe(8);
		expect(ledger.perAttendeeAmountCents).toBe(194_500);
		expect(ledger.fixedAmountCents).toBe(210_000);
	});

	it('omits the Unassigned row when every allocation matches a line', () => {
		const matched = allocations.filter(
			(row) => row.budgetItem !== null && row.budgetItem !== 'Baggage fees'
		);
		const clean = buildTripBudget(lines, matched, ATTENDEES);
		expect(clean.rows).toHaveLength(5);
		expect(clean.rows.filter((row) => row.group === 'unassigned')).toHaveLength(0);
		expect(clean.totalActualCents).toBe(sumOf(matched));
	});

	it('shows an Unassigned row for a zero-cent untagged allocation', () => {
		// A $0 row is still a row; dropping it would lose its proof count.
		const zero = buildTripBudget(lines, [{ budgetItem: null, amountCents: 0 }], ATTENDEES);
		const unassigned = zero.rows.find((row) => row.group === 'unassigned')!;
		expect(unassigned.actualCents).toBe(0);
		expect(unassigned.proofCount).toBe(1);
	});

	it('renders the empty actuals panel state — lines, no spend', () => {
		const planned = buildTripBudget(lines, [], ATTENDEES);
		expect(planned.rows).toHaveLength(5);
		expect(planned.rows.every((row) => row.actualCents === 0)).toBe(true);
		expect(planned.rows.every((row) => row.proofCount === 0)).toBe(true);
		expect(planned.totalActualCents).toBe(0);
		expect(planned.remainingCents).toBe(1_766_000);
	});

	it('survives a trip with no budget lines but real spend', () => {
		const unplanned = buildTripBudget([], allocations, ATTENDEES);
		expect(unplanned.rows).toHaveLength(1);
		expect(unplanned.rows[0].group).toBe('unassigned');
		expect(unplanned.totalPlannedCents).toBe(0);
		expect(unplanned.totalActualCents).toBe(sumOf(allocations));
		expect(unplanned.remainingCents).toBe(-sumOf(allocations));
	});

	it('survives an entirely empty trip', () => {
		const empty = buildTripBudget([], [], 0);
		expect(empty.rows).toEqual([]);
		expect(empty.totalPlannedCents).toBe(0);
		expect(empty.totalActualCents).toBe(0);
		expect(empty.remainingCents).toBe(0);
		expect(empty.attendeeCount).toBe(0);
	});

	it('yields a null ratio for a zero-planned line', () => {
		const free: TripBudgetLine[] = [
			{ label: 'Donated lodging', amountCents: 0, perAttendee: false, order: 0 }
		];
		const donated = buildTripBudget(
			free,
			[{ budgetItem: 'Donated lodging', amountCents: 5_000 }],
			ATTENDEES
		);
		expect(donated.rows[0].plannedCents).toBe(0);
		expect(donated.rows[0].ratio).toBeNull();
		expect(donated.rows[0].deltaCents).toBe(5_000);
	});

	it('plans per-seat lines to zero before anyone is confirmed', () => {
		const draft = buildTripBudget(lines, [], 0);
		expect(draft.rows[0].plannedCents).toBe(0);
		expect(draft.rows[0].ratio).toBeNull();
		expect(draft.totalPlannedCents).toBe(210_000);
	});

	it('matches tags exactly after trimming, and rolls a case mismatch into Unassigned', () => {
		// Case-insensitive matching would silently merge a line someone meant to
		// keep separate; the money still reconciles, visibly, as Unassigned.
		const mixed = buildTripBudget(
			lines,
			[
				{ budgetItem: '  Airfare  ', amountCents: 1_000 },
				{ budgetItem: 'airfare', amountCents: 2_000 }
			],
			ATTENDEES
		);
		expect(mixed.rows[0].actualCents).toBe(1_000);
		expect(mixed.rows.find((row) => row.group === 'unassigned')!.actualCents).toBe(2_000);
		expect(mixed.totalActualCents).toBe(3_000);
	});

	it('does not double-count when two lines share a label', () => {
		// `label` is free text, so nothing stops it. First line wins; the total
		// still ties out to the money actually spent.
		const duplicated: TripBudgetLine[] = [
			{ label: 'Airfare', amountCents: 100_000, perAttendee: false, order: 0 },
			{ label: 'Airfare', amountCents: 50_000, perAttendee: false, order: 1 }
		];
		const dupe = buildTripBudget(duplicated, [{ budgetItem: 'Airfare', amountCents: 90_000 }], 4);
		expect(dupe.rows[0].actualCents).toBe(90_000);
		expect(dupe.rows[1].actualCents).toBe(0);
		expect(dupe.totalActualCents).toBe(90_000);
		expect(dupe.totalPlannedCents).toBe(150_000);
	});

	it('gives every row a unique render key even against an "Unassigned" line', () => {
		const collide: TripBudgetLine[] = [
			{ label: 'Unassigned', amountCents: 1_000, perAttendee: false, order: 0 }
		];
		const clash = buildTripBudget(
			collide,
			[
				{ budgetItem: 'Unassigned', amountCents: 400 },
				{ budgetItem: null, amountCents: 600 }
			],
			ATTENDEES
		);
		expect(clash.rows).toHaveLength(2);
		expect(new Set(clash.rows.map((row) => row.rowId)).size).toBe(2);
		// The literal tag hits the real line; only the untagged row is synthetic.
		expect(clash.rows[0].group).toBe('line');
		expect(clash.rows[0].actualCents).toBe(400);
		expect(clash.rows[1].group).toBe('unassigned');
		expect(clash.rows[1].actualCents).toBe(600);
		expect(clash.totalActualCents).toBe(1_000);
	});

	it('takes a custom label for the synthetic row', () => {
		const custom = buildTripBudget(lines, allocations, ATTENDEES, 'Untagged spending');
		expect(custom.rows[5].label).toBe('Untagged spending');
		expect(custom.rows[5].key).toBe(UNASSIGNED_TRIP_BUDGET_ITEM);
	});

	it("does not mutate the caller's lines", () => {
		const input = [lines[3], lines[0]];
		buildTripBudget(input, allocations, ATTENDEES);
		expect(input.map((line) => line.label)).toEqual(['Visas', 'Airfare']);
	});

	it('keeps every money field an integer', () => {
		for (const row of ledger.rows) {
			expect(Number.isInteger(row.unitAmountCents)).toBe(true);
			expect(Number.isInteger(row.plannedCents)).toBe(true);
			expect(Number.isInteger(row.actualCents)).toBe(true);
			expect(Number.isInteger(row.deltaCents)).toBe(true);
		}
		expect(Number.isInteger(ledger.totalPlannedCents)).toBe(true);
		expect(Number.isInteger(ledger.totalActualCents)).toBe(true);
		expect(Number.isInteger(ledger.remainingCents)).toBe(true);
	});
});
