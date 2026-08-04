// Pure itinerary math over trip flight legs — no db imports.
//
// PLAN-trips.md §5 is the whole reason this file exists. A flight time is stored
// as TWO halves of one fact:
//
//   departureAt        'YYYY-MM-DDTHH:mm' — the LOCAL WALL CLOCK at the airport,
//                      with NO zone suffix. This is what the boarding pass says
//                      and the only rendering that is never wrong.
//   departureTimeZone  an IANA zone ('America/Chicago'), OPTIONAL — the half
//                      that makes the wall clock computable.
//
// Two rules follow, and every function here obeys them:
//
// 1. NEVER `new Date(wallClock)`. Passing a bare 'YYYY-MM-DDTHH:mm' to the Date
//    constructor silently reinterprets it in the *runtime's* zone (the server's,
//    or the viewer's browser), so a coordinator in Tulsa would see a departure
//    time that appears nowhere on the ticket. Display parses the string by hand
//    and renders it verbatim.
// 2. Anything that needs a real INSTANT — duration, layover, total travel time,
//    "has it left yet" — needs the zone. When the zone is absent we return
//    `null` rather than guess. §17: no airport timezone database; this module
//    degrades, it does not invent an offset.
//
// The one exception to rule 1 is `Date.UTC(...)` on already-parsed integer
// components, which is explicit and zone-free. That is how we get weekday names
// and calendar-day arithmetic without touching the runtime's zone.

export type TripDirection = 'outbound' | 'return';

/**
 * The structural shape this module needs from a `tripSegments` row. Kept as an
 * interface rather than the Convex `Doc` so the module stays db-free and the
 * tests can build legs by hand. Callers pass their real docs; the generics on
 * the merge/sort helpers preserve the caller's extra fields.
 */
export interface ItineraryLeg {
	direction: TripDirection;
	/** Leg order within a direction: DFW->DOH is 0, DOH->ISB is 1. */
	order: number;
	/** Local wall clock at the departure airport, 'YYYY-MM-DDTHH:mm'. */
	departureAt: string;
	/** Local wall clock at the arrival airport, 'YYYY-MM-DDTHH:mm'. */
	arrivalAt: string;
	/** IANA zone for `departureAt`. Absent = every computation degrades to null. */
	departureTimeZone?: string | null;
	/** IANA zone for `arrivalAt`. Absent = every computation degrades to null. */
	arrivalTimeZone?: string | null;
}

// ---------------------------------------------------------------------------
// The wall clock: parsing and rendering, with no zone anywhere in sight.
// ---------------------------------------------------------------------------

export interface WallClock {
	year: number;
	/** 1-12, not the 0-11 the Date API uses. */
	month: number;
	day: number;
	/** 0-23. */
	hour: number;
	minute: number;
}

// Deliberately anchored (^...$) and deliberately WITHOUT an optional zone
// suffix: a stored value ending in 'Z' or '+05:00' means something upstream
// wrote the wrong thing, and quietly accepting it would hide the bug this
// module exists to prevent. Seconds are tolerated because a paste from another
// system may carry them; flights are not quoted to the second.
const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;

const DAYS_MS = 86_400_000;

/**
 * Parse a stored wall clock into its integer components, or null when the value
 * is missing, malformed, or not a real calendar time (2026-02-30, 25:00).
 * No Date parsing, no zone: this is pure string arithmetic.
 */
export function parseWallClock(value: string | null | undefined): WallClock | null {
	if (!value) return null;
	const match = WALL_CLOCK_RE.exec(value.trim());
	if (!match) return null;

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);

	if (month < 1 || month > 12) return null;
	if (day < 1 || day > 31) return null;
	if (hour > 23 || minute > 59) return null;

	// Catches 2026-02-30 and 2027-02-29: Date.UTC normalizes an overflowing day
	// into the next month, so a round-trip that changes the day is a bad date.
	// Date.UTC on integers is zone-free — this is not `new Date(string)`.
	const probe = new Date(Date.UTC(year, month - 1, day));
	if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1) return null;
	if (probe.getUTCDate() !== day) return null;

	return { year, month, day, hour, minute };
}

const MONTH_LABELS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The day of the week a wall-clock DATE falls on. Zone-free by construction: a
 * calendar date has exactly one weekday no matter who is looking at it, and
 * `Date.UTC` on parsed integers never consults the runtime's zone.
 */
export function wallClockWeekday(value: string | null | undefined): string | null {
	const wc = parseWallClock(value);
	if (!wc) return null;
	return WEEKDAY_LABELS[new Date(Date.UTC(wc.year, wc.month - 1, wc.day)).getUTCDay()];
}

/**
 * '2026-12-05T21:35' -> '9:35 PM'. Rendered from the parsed digits, never from
 * a Date — this is the string on the ticket and it is reproduced verbatim.
 * An unparseable value is returned unchanged rather than blanked: showing the
 * raw stored text beats showing nothing on a boarding-pass row.
 */
export function formatWallClockTime(
	value: string | null | undefined,
	options: { hour12?: boolean } = {}
): string {
	const wc = parseWallClock(value);
	if (!wc) return value ?? '';

	const minute = String(wc.minute).padStart(2, '0');
	if (options.hour12 === false) {
		return `${String(wc.hour).padStart(2, '0')}:${minute}`;
	}
	const suffix = wc.hour < 12 ? 'AM' : 'PM';
	const hour12 = wc.hour % 12 === 0 ? 12 : wc.hour % 12;
	return `${hour12}:${minute} ${suffix}`;
}

/** '2026-12-05T21:35' -> 'Dec 5', or 'Sat, Dec 5' with `weekday: true`. */
export function formatWallClockDate(
	value: string | null | undefined,
	options: { weekday?: boolean } = {}
): string {
	const wc = parseWallClock(value);
	if (!wc) return value ?? '';

	const date = `${MONTH_LABELS[wc.month - 1]} ${wc.day}`;
	if (!options.weekday) return date;
	return `${wallClockWeekday(value)}, ${date}`;
}

/** '2026-12-05T21:35' -> 'Sat, Dec 5 · 9:35 PM'. */
export function formatWallClockDateTime(
	value: string | null | undefined,
	options: { weekday?: boolean; hour12?: boolean } = {}
): string {
	const wc = parseWallClock(value);
	if (!wc) return value ?? '';
	return `${formatWallClockDate(value, { weekday: options.weekday ?? true })} · ${formatWallClockTime(value, options)}`;
}

// ---------------------------------------------------------------------------
// Wall clock + IANA zone -> a real instant.
// ---------------------------------------------------------------------------

// Intl.DateTimeFormat construction is expensive and an itinerary panel resolves
// the same two or three zones for every leg on every render, so formatters are
// memoized. Invalid zones are memoized as `null` too — `new Intl.DateTimeFormat`
// throws RangeError on a bad IANA id, and we must not re-throw (a coordinator
// typo in the zone field degrades to "cannot compute", per §5).
const formatterCache = new Map<string, Intl.DateTimeFormat | null>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat | null {
	const cached = formatterCache.get(timeZone);
	if (cached !== undefined) return cached;

	let formatter: Intl.DateTimeFormat | null = null;
	try {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone,
			// Pinned so `formatToParts` returns plain Latin digits on a Gregorian
			// calendar regardless of the host's ICU defaults. Without these, a
			// runtime defaulting to another calendar or numbering system would
			// hand us year/day values that Number() cannot read.
			calendar: 'gregory',
			numberingSystem: 'latn',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			// h23 rather than `hour12: false`, which yields '24' for midnight on
			// some ICU builds.
			hourCycle: 'h23'
		});
	} catch {
		formatter = null;
	}
	formatterCache.set(timeZone, formatter);
	return formatter;
}

/**
 * The zone's UTC offset in ms at a given instant (positive east of Greenwich).
 * Read by formatting the instant IN the zone and re-reading those wall-clock
 * parts as if they were UTC: the difference is exactly the offset in force.
 */
function zoneOffsetMs(instantMs: number, timeZone: string): number | null {
	const formatter = zoneFormatter(timeZone);
	if (!formatter) return null;

	const parts: Record<string, number> = {};
	for (const part of formatter.formatToParts(new Date(instantMs))) {
		if (part.type !== 'literal') parts[part.type] = Number(part.value);
	}
	if (parts.year === undefined || Number.isNaN(parts.year)) return null;

	const asUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour % 24,
		parts.minute,
		parts.second
	);
	return asUtc - instantMs;
}

/**
 * Resolve a wall clock in an IANA zone to a real epoch-ms instant, or null when
 * either half is missing or unusable. This is the ONLY bridge between the two
 * halves of a stored flight time, and every duration in this file goes through
 * it.
 *
 * The standard two-pass trick, since the offset we need depends on the instant
 * we are trying to find: read the wall clock AS IF it were UTC, ask the zone
 * what its offset was at that (wrong but close) instant, subtract to get a
 * candidate, then re-ask at the candidate. The second pass only changes the
 * answer within a day of a DST transition, which is exactly when it matters.
 *
 * Times that do not exist (the spring-forward gap) resolve to the instant one
 * offset-step away rather than throwing — the same forgiving behaviour every
 * date library picks, and not a case a real published flight schedule contains.
 */
export function wallClockToInstant(
	wallClock: string | null | undefined,
	timeZone: string | null | undefined
): number | null {
	const wc = parseWallClock(wallClock);
	if (!wc || !timeZone) return null;

	const guess = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute);
	const firstOffset = zoneOffsetMs(guess, timeZone);
	if (firstOffset === null) return null;

	const candidate = guess - firstOffset;
	const secondOffset = zoneOffsetMs(candidate, timeZone);
	if (secondOffset === null) return null;
	if (secondOffset === firstOffset) return candidate;

	return guess - secondOffset;
}

/** A leg's departure as a real instant, or null without `departureTimeZone`. */
export function departureInstant(leg: ItineraryLeg): number | null {
	return wallClockToInstant(leg.departureAt, leg.departureTimeZone);
}

/** A leg's arrival as a real instant, or null without `arrivalTimeZone`. */
export function arrivalInstant(leg: ItineraryLeg): number | null {
	return wallClockToInstant(leg.arrivalAt, leg.arrivalTimeZone);
}

/**
 * "Has this flight left yet" — the question §5 says a wall-clock string alone
 * cannot answer. Null when the departure zone is absent, because the honest
 * answer is "we cannot know" and not "no".
 */
export function hasDeparted(leg: ItineraryLeg, nowMs: number = Date.now()): boolean | null {
	const departure = departureInstant(leg);
	if (departure === null) return null;
	return nowMs >= departure;
}

// ---------------------------------------------------------------------------
// Durations.
// ---------------------------------------------------------------------------

const toMinutes = (ms: number) => Math.round(ms / 60_000);

/**
 * Time in the air for one leg, in minutes. Requires BOTH zones: the wall-clock
 * difference is not the duration (DFW 21:35 -> DOH 21:05 is 14h30m, not a
 * negative half hour), and across a DST boundary it is off by an hour even
 * within a single zone.
 *
 * A negative result means the stored data is wrong (arrival before departure).
 * It is returned rather than swallowed so the UI can flag the row; hiding it
 * would make a typo look like a missing zone.
 */
export function legDurationMinutes(leg: ItineraryLeg): number | null {
	const departure = departureInstant(leg);
	const arrival = arrivalInstant(leg);
	if (departure === null || arrival === null) return null;
	return toMinutes(arrival - departure);
}

/**
 * Ground time between two consecutive legs, in minutes: the gap between where
 * the first one lands and the next one leaves. Requires the first leg's ARRIVAL
 * zone and the second leg's DEPARTURE zone — usually the same airport, but the
 * module never assumes that.
 */
export function layoverMinutes(previous: ItineraryLeg, next: ItineraryLeg): number | null {
	const landed = arrivalInstant(previous);
	const leaves = departureInstant(next);
	if (landed === null || leaves === null) return null;
	return toMinutes(leaves - landed);
}

/**
 * Door-to-door time for a direction, in minutes: first departure to last
 * arrival, layovers included.
 *
 * Only the two ENDPOINT zones are required. A middle leg missing a zone leaves
 * its own duration and its layovers unknown but does not change the total, so
 * declining to compute here would throw away an answer we actually have.
 * Legs are sorted by `order` first — the caller may hand us anything.
 */
export function totalTravelMinutes(legs: ItineraryLeg[]): number | null {
	if (legs.length === 0) return null;
	const ordered = sortLegsByOrder(legs);
	const start = departureInstant(ordered[0]);
	const end = arrivalInstant(ordered[ordered.length - 1]);
	if (start === null || end === null) return null;
	return toMinutes(end - start);
}

/** 870 -> '14h 30m', 180 -> '3h', 45 -> '45m', -30 -> '-30m'. */
export function formatDurationMinutes(minutes: number): string {
	const sign = minutes < 0 ? '-' : '';
	const total = Math.abs(Math.round(minutes));
	const hours = Math.floor(total / 60);
	const rest = total % 60;
	if (hours === 0) return `${sign}${rest}m`;
	if (rest === 0) return `${sign}${hours}h`;
	return `${sign}${hours}h ${rest}m`;
}

// ---------------------------------------------------------------------------
// The "+1" badge.
// ---------------------------------------------------------------------------

/**
 * How many calendar days later the arrival's local date is than the
 * departure's: the '+1' a boarding pass prints, and occasionally '-1' flying
 * east-to-west across the date line (Tokyo Sunday 00:30 lands Los Angeles
 * Saturday 17:30).
 *
 * Needs NO zones, and that is the point: both halves are already local dates at
 * their own airports, so this is the one piece of arithmetic that still works
 * on a leg entered at midnight with the zone fields left blank.
 */
export function calendarDayOffset(leg: ItineraryLeg): number | null {
	const departure = parseWallClock(leg.departureAt);
	const arrival = parseWallClock(leg.arrivalAt);
	if (!departure || !arrival) return null;

	const departureDay = Date.UTC(departure.year, departure.month - 1, departure.day);
	const arrivalDay = Date.UTC(arrival.year, arrival.month - 1, arrival.day);
	// Both are exact UTC midnights, so this division is never fractional.
	return (arrivalDay - departureDay) / DAYS_MS;
}

/** True when the leg lands on a later calendar day than it left. */
export function arrivesNextDay(leg: ItineraryLeg): boolean {
	const offset = calendarDayOffset(leg);
	return offset !== null && offset > 0;
}

// ---------------------------------------------------------------------------
// Sorting and merging.
// ---------------------------------------------------------------------------

/**
 * Legs in itinerary order. `[...].sort()` rather than `.toSorted()` — same
 * semantics, but `toSorted` is ES2023 and the Convex tsc program
 * (src/convex/tsconfig.json) pins lib to ES2021.
 */
export function sortLegsByOrder<L extends ItineraryLeg>(legs: L[]): L[] {
	return [...legs].sort((a, b) => a.order - b.order);
}

const DIRECTION_RANK: Record<TripDirection, number> = { outbound: 0, return: 1 };

/** Outbound legs in order, then return legs in order. */
export function sortLegsForDisplay<L extends ItineraryLeg>(legs: L[]): L[] {
	return [...legs].sort(
		(a, b) => DIRECTION_RANK[a.direction] - DIRECTION_RANK[b.direction] || a.order - b.order
	);
}

/**
 * Legs sorted by when they actually LAND — the airport pickup list §5 is
 * written for, where a group leg and one attendee's own late flight have to
 * interleave correctly.
 *
 * Legs whose arrival instant cannot be resolved (no `arrivalTimeZone`) keep
 * their relative order and go last, rather than being silently placed by their
 * wall clock as if every airport were in one zone. Array.prototype.sort is
 * stable per spec, so "keep their relative order" is guaranteed.
 */
export function sortLegsByArrivalInstant<L extends ItineraryLeg>(legs: L[]): L[] {
	const instants = new Map<L, number | null>();
	for (const leg of legs) instants.set(leg, arrivalInstant(leg));

	return [...legs].sort((a, b) => {
		const left = instants.get(a) ?? null;
		const right = instants.get(b) ?? null;
		if (left === null && right === null) return 0;
		if (left === null) return 1;
		if (right === null) return -1;
		return left - right;
	});
}

/** Where a direction's legs came from once the group and personal sets merge. */
export type LegSource = 'attendee' | 'group' | 'none';

export interface EffectiveItinerary<L extends ItineraryLeg> {
	outbound: L[];
	/** Legal as a property name; `itinerary.return` reads the way the schema does. */
	return: L[];
	/** Outbound then return, in order — the flat list the trip page renders. */
	legs: L[];
	outboundSource: LegSource;
	returnSource: LegSource;
}

/**
 * One attendee's effective itinerary: their own legs REPLACE the group's for
 * any direction they cover, and the group's stand for the rest.
 *
 * Replacement per direction, not per leg and not merged together, because §5's
 * "different flights" action copies the group legs onto the attendee and opens
 * the same form — so an attendee row that exists for a direction is already the
 * complete story for that direction. Unioning the two sets instead would put
 * the coordinator on two aircraft at once, and overriding by `order` would
 * break the moment a personal routing has a different number of connections
 * (the joins-from-another-city case that put per-person legs in v1 at all).
 *
 * `attendeeLegs` is expected to be pre-filtered to one attendee — the caller
 * has the `by_attendeeId` index and this module has no db.
 */
export function effectiveItinerary<L extends ItineraryLeg>(
	groupLegs: L[],
	attendeeLegs: L[]
): EffectiveItinerary<L> {
	const pick = (direction: TripDirection): { legs: L[]; source: LegSource } => {
		const own = sortLegsByOrder(attendeeLegs.filter((leg) => leg.direction === direction));
		if (own.length > 0) return { legs: own, source: 'attendee' };

		const shared = sortLegsByOrder(groupLegs.filter((leg) => leg.direction === direction));
		return { legs: shared, source: shared.length > 0 ? 'group' : 'none' };
	};

	const outbound = pick('outbound');
	const inbound = pick('return');

	return {
		outbound: outbound.legs,
		return: inbound.legs,
		legs: [...outbound.legs, ...inbound.legs],
		outboundSource: outbound.source,
		returnSource: inbound.source
	};
}

// ---------------------------------------------------------------------------
// The panel's view of one direction.
// ---------------------------------------------------------------------------

export interface LegTiming<L extends ItineraryLeg> {
	leg: L;
	durationMinutes: number | null;
	/** Ground time before this leg; null on the first leg of a direction. */
	layoverBeforeMinutes: number | null;
	calendarDayOffset: number | null;
	arrivesNextDay: boolean;
}

export interface DirectionSummary<L extends ItineraryLeg> {
	legs: LegTiming<L>[];
	/** First departure to last arrival, layovers included. */
	totalTravelMinutes: number | null;
	/** Sum of the layovers, or null when any one of them is unknown. */
	totalLayoverMinutes: number | null;
	/** True when at least one number could not be computed for want of a zone. */
	hasMissingZones: boolean;
}

/**
 * Everything the itinerary panel needs for one direction, computed once so a
 * Svelte template does not call four helpers per row. `hasMissingZones` is what
 * drives the "add a timezone to see durations" hint instead of a wall of
 * em-dashes with no explanation.
 */
export function summarizeDirection<L extends ItineraryLeg>(legs: L[]): DirectionSummary<L> {
	const ordered = sortLegsByOrder(legs);

	const timings: LegTiming<L>[] = ordered.map((leg, index) => ({
		leg,
		durationMinutes: legDurationMinutes(leg),
		layoverBeforeMinutes: index === 0 ? null : layoverMinutes(ordered[index - 1], leg),
		calendarDayOffset: calendarDayOffset(leg),
		arrivesNextDay: arrivesNextDay(leg)
	}));

	let totalLayoverMinutes: number | null = ordered.length > 1 ? 0 : null;
	for (const timing of timings) {
		if (timing.layoverBeforeMinutes === null) continue;
		if (totalLayoverMinutes !== null) totalLayoverMinutes += timing.layoverBeforeMinutes;
	}
	// One unknown layover makes the sum a lie, not an approximation.
	if (timings.some((t, i) => i > 0 && t.layoverBeforeMinutes === null)) totalLayoverMinutes = null;

	const hasMissingZones = ordered.some((leg) => !leg.departureTimeZone || !leg.arrivalTimeZone);

	return {
		legs: timings,
		totalTravelMinutes: totalTravelMinutes(ordered),
		totalLayoverMinutes,
		hasMissingZones
	};
}
