import { describe, expect, it } from 'vitest';
import {
	arrivalInstant,
	arrivesNextDay,
	calendarDayOffset,
	departureInstant,
	effectiveItinerary,
	formatDurationMinutes,
	formatWallClockDate,
	formatWallClockDateTime,
	formatWallClockTime,
	hasDeparted,
	layoverMinutes,
	legDurationMinutes,
	parseWallClock,
	sortLegsByArrivalInstant,
	sortLegsByOrder,
	sortLegsForDisplay,
	summarizeDirection,
	totalTravelMinutes,
	wallClockToInstant,
	wallClockWeekday,
	type ItineraryLeg
} from './trip-itinerary';

// A real Dallas -> Islamabad itinerary, the one §5 is written about. Three
// zones, a +10 and a +11 hour swing, an overnight that lands on the next
// calendar day, and a westbound return that lands the SAME calendar day it
// left despite being sixteen hours in the air.
//
//   America/Chicago  UTC-6 in December
//   Asia/Qatar       UTC+3, no DST
//   Asia/Karachi     UTC+5, no DST
//
// Every wall clock below is the local time at that airport, exactly as it would
// be printed on the ticket.

interface Leg extends ItineraryLeg {
	airline: string;
	flightNumber: string;
	departureAirport: string;
	arrivalAirport: string;
}

const dfwToDoh: Leg = {
	direction: 'outbound',
	order: 0,
	airline: 'QR',
	flightNumber: '730',
	departureAirport: 'DFW',
	arrivalAirport: 'DOH',
	departureAt: '2026-12-05T21:35', // Sat 9:35 PM Dallas = 2026-12-06T03:35Z
	arrivalAt: '2026-12-06T21:05', // Sun 9:05 PM Doha   = 2026-12-06T18:05Z
	departureTimeZone: 'America/Chicago',
	arrivalTimeZone: 'Asia/Qatar'
};

const dohToIsb: Leg = {
	direction: 'outbound',
	order: 1,
	airline: 'QR',
	flightNumber: '632',
	departureAirport: 'DOH',
	arrivalAirport: 'ISB',
	departureAt: '2026-12-07T02:10', // Mon 2:10 AM Doha      = 2026-12-06T23:10Z
	arrivalAt: '2026-12-07T08:00', // Mon 8:00 AM Islamabad = 2026-12-07T03:00Z
	departureTimeZone: 'Asia/Qatar',
	arrivalTimeZone: 'Asia/Karachi'
};

const isbToDoh: Leg = {
	direction: 'return',
	order: 0,
	airline: 'QR',
	flightNumber: '633',
	departureAirport: 'ISB',
	arrivalAirport: 'DOH',
	departureAt: '2026-12-19T09:00', // = 2026-12-19T04:00Z
	arrivalAt: '2026-12-19T11:10', // = 2026-12-19T08:10Z
	departureTimeZone: 'Asia/Karachi',
	arrivalTimeZone: 'Asia/Qatar'
};

const dohToDfw: Leg = {
	direction: 'return',
	order: 1,
	airline: 'QR',
	flightNumber: '729',
	departureAirport: 'DOH',
	arrivalAirport: 'DFW',
	departureAt: '2026-12-19T13:20', // = 2026-12-19T10:20Z
	arrivalAt: '2026-12-19T20:35', // = 2026-12-20T02:35Z — same date, 16h15m later
	departureTimeZone: 'Asia/Qatar',
	arrivalTimeZone: 'America/Chicago'
};

const groupLegs: Leg[] = [dfwToDoh, dohToIsb, isbToDoh, dohToDfw];

const utc = (iso: string) => new Date(iso).getTime();

describe('parseWallClock', () => {
	it('reads the stored components without a Date round-trip', () => {
		expect(parseWallClock('2026-12-05T21:35')).toEqual({
			year: 2026,
			month: 12,
			day: 5,
			hour: 21,
			minute: 35
		});
	});

	it('tolerates a seconds component but ignores it', () => {
		expect(parseWallClock('2026-12-05T21:35:00')).toEqual({
			year: 2026,
			month: 12,
			day: 5,
			hour: 21,
			minute: 35
		});
	});

	it('rejects a value carrying a zone suffix — that is the bug, not an input', () => {
		expect(parseWallClock('2026-12-05T21:35Z')).toBeNull();
		expect(parseWallClock('2026-12-05T21:35+05:00')).toBeNull();
		expect(parseWallClock('2026-12-05T21:35-06:00')).toBeNull();
	});

	it('rejects malformed, empty and impossible values', () => {
		expect(parseWallClock(undefined)).toBeNull();
		expect(parseWallClock(null)).toBeNull();
		expect(parseWallClock('')).toBeNull();
		expect(parseWallClock('2026-12-05')).toBeNull();
		expect(parseWallClock('12/05/2026 9:35 PM')).toBeNull();
		expect(parseWallClock('2026-02-30T09:00')).toBeNull();
		expect(parseWallClock('2027-02-29T09:00')).toBeNull();
		expect(parseWallClock('2026-13-01T09:00')).toBeNull();
		expect(parseWallClock('2026-12-05T25:00')).toBeNull();
		expect(parseWallClock('2026-12-05T21:60')).toBeNull();
	});

	it('accepts a leap day that really exists', () => {
		expect(parseWallClock('2028-02-29T09:00')).not.toBeNull();
	});
});

describe('wall clock rendering', () => {
	it('renders the ticket time verbatim, whatever zone the runtime is in', () => {
		expect(formatWallClockTime('2026-12-05T21:35')).toBe('9:35 PM');
		expect(formatWallClockTime('2026-12-07T02:10')).toBe('2:10 AM');
		expect(formatWallClockTime('2026-12-07T08:00')).toBe('8:00 AM');
	});

	it('handles both ends of the 12-hour wrap', () => {
		expect(formatWallClockTime('2026-12-05T00:05')).toBe('12:05 AM');
		expect(formatWallClockTime('2026-12-05T12:00')).toBe('12:00 PM');
		expect(formatWallClockTime('2026-12-05T23:55')).toBe('11:55 PM');
	});

	it('renders 24-hour on request', () => {
		expect(formatWallClockTime('2026-12-05T21:35', { hour12: false })).toBe('21:35');
		expect(formatWallClockTime('2026-12-05T00:05', { hour12: false })).toBe('00:05');
	});

	it('derives the weekday from the calendar date alone', () => {
		expect(wallClockWeekday('2026-12-05T21:35')).toBe('Sat');
		expect(wallClockWeekday('2026-12-06T21:05')).toBe('Sun');
		expect(wallClockWeekday('2026-12-07T02:10')).toBe('Mon');
		expect(wallClockWeekday('nonsense')).toBeNull();
	});

	it('formats dates and datetimes', () => {
		expect(formatWallClockDate('2026-12-05T21:35')).toBe('Dec 5');
		expect(formatWallClockDate('2026-12-05T21:35', { weekday: true })).toBe('Sat, Dec 5');
		expect(formatWallClockDateTime('2026-12-05T21:35')).toBe('Sat, Dec 5 · 9:35 PM');
	});

	it('echoes an unparseable value rather than blanking a boarding-pass row', () => {
		expect(formatWallClockTime('TBD')).toBe('TBD');
		expect(formatWallClockDate('TBD')).toBe('TBD');
		expect(formatWallClockTime(undefined)).toBe('');
	});
});

describe('wallClockToInstant', () => {
	it('resolves each leg of the real itinerary to the right instant', () => {
		expect(wallClockToInstant('2026-12-05T21:35', 'America/Chicago')).toBe(
			utc('2026-12-06T03:35:00Z')
		);
		expect(wallClockToInstant('2026-12-06T21:05', 'Asia/Qatar')).toBe(utc('2026-12-06T18:05:00Z'));
		expect(wallClockToInstant('2026-12-07T02:10', 'Asia/Qatar')).toBe(utc('2026-12-06T23:10:00Z'));
		expect(wallClockToInstant('2026-12-07T08:00', 'Asia/Karachi')).toBe(
			utc('2026-12-07T03:00:00Z')
		);
		expect(wallClockToInstant('2026-12-19T20:35', 'America/Chicago')).toBe(
			utc('2026-12-20T02:35:00Z')
		);
	});

	it('applies the summer offset when the date is in DST', () => {
		// Chicago is UTC-5 in July, UTC-6 in December. Same wall clock, different
		// instants — the whole reason the second half of the fact is stored.
		expect(wallClockToInstant('2026-07-05T21:35', 'America/Chicago')).toBe(
			utc('2026-07-06T02:35:00Z')
		);
		expect(wallClockToInstant('2026-12-05T21:35', 'America/Chicago')).toBe(
			utc('2026-12-06T03:35:00Z')
		);
	});

	it('degrades to null on a missing or bogus zone instead of guessing', () => {
		expect(wallClockToInstant('2026-12-05T21:35', undefined)).toBeNull();
		expect(wallClockToInstant('2026-12-05T21:35', null)).toBeNull();
		expect(wallClockToInstant('2026-12-05T21:35', '')).toBeNull();
		expect(wallClockToInstant('2026-12-05T21:35', 'Mars/Olympus_Mons')).toBeNull();
		expect(wallClockToInstant('2026-12-05T21:35', 'America/Dallas')).toBeNull(); // not a zone
	});

	it('degrades to null on an unusable wall clock', () => {
		expect(wallClockToInstant('2026-12-05T21:35Z', 'America/Chicago')).toBeNull();
		expect(wallClockToInstant(undefined, 'America/Chicago')).toBeNull();
	});
});

describe('leg duration', () => {
	it('computes the fourteen-and-a-half-hour DFW->DOH leg', () => {
		// Wall clocks say 21:35 -> 21:05, which naively reads as MINUS 30 minutes.
		expect(legDurationMinutes(dfwToDoh)).toBe(870);
		expect(formatDurationMinutes(870)).toBe('14h 30m');
	});

	it('computes the DOH->ISB connection', () => {
		expect(legDurationMinutes(dohToIsb)).toBe(230);
		expect(formatDurationMinutes(230)).toBe('3h 50m');
	});

	it('computes both return legs, including the westbound sixteen-hour haul', () => {
		expect(legDurationMinutes(isbToDoh)).toBe(250);
		// 13:20 Doha -> 20:35 Dallas looks like 7h15m on the wall clocks.
		expect(legDurationMinutes(dohToDfw)).toBe(975);
		expect(formatDurationMinutes(975)).toBe('16h 15m');
	});

	it('returns null when either zone is absent', () => {
		expect(legDurationMinutes({ ...dfwToDoh, departureTimeZone: undefined })).toBeNull();
		expect(legDurationMinutes({ ...dfwToDoh, arrivalTimeZone: undefined })).toBeNull();
		expect(
			legDurationMinutes({ ...dfwToDoh, departureTimeZone: null, arrivalTimeZone: null })
		).toBeNull();
	});

	it('surfaces a negative duration rather than hiding a data-entry mistake', () => {
		// Doha 02:10 (23:10Z) -> Islamabad 01:00 (20:00Z): the arrival was typed
		// on the wrong day. -3h10m is returned so the row can be flagged; nulling
		// it would make a typo look like a missing zone.
		const backwards: Leg = { ...dohToIsb, arrivalAt: '2026-12-07T01:00' };
		expect(legDurationMinutes(backwards)).toBe(-190);
	});
});

describe('DST boundaries', () => {
	// America/Chicago springs forward 2026-03-08 at 02:00 (CST -> CDT) and falls
	// back 2026-11-01 at 02:00 (CDT -> CST). A domestic red-eye straddling each
	// transition is where a wall-clock subtraction is off by exactly an hour.
	const springForward: ItineraryLeg = {
		direction: 'outbound',
		order: 0,
		departureAt: '2026-03-08T00:30', // CST = 06:30Z
		arrivalAt: '2026-03-08T04:30', // CDT = 09:30Z
		departureTimeZone: 'America/Chicago',
		arrivalTimeZone: 'America/Chicago'
	};

	const fallBack: ItineraryLeg = {
		direction: 'return',
		order: 0,
		departureAt: '2026-11-01T00:30', // CDT = 05:30Z
		arrivalAt: '2026-11-01T03:30', // CST = 09:30Z
		departureTimeZone: 'America/Chicago',
		arrivalTimeZone: 'America/Chicago'
	};

	it('loses an hour across spring forward', () => {
		expect(departureInstant(springForward)).toBe(utc('2026-03-08T06:30:00Z'));
		expect(arrivalInstant(springForward)).toBe(utc('2026-03-08T09:30:00Z'));
		// The clocks read four hours apart; the flight was three.
		expect(legDurationMinutes(springForward)).toBe(180);
	});

	it('gains an hour across fall back', () => {
		expect(departureInstant(fallBack)).toBe(utc('2026-11-01T05:30:00Z'));
		expect(arrivalInstant(fallBack)).toBe(utc('2026-11-01T09:30:00Z'));
		// The clocks read three hours apart; the flight was four.
		expect(legDurationMinutes(fallBack)).toBe(240);
	});

	it('picks the correct offset on either side of a transition instant', () => {
		expect(wallClockToInstant('2026-03-08T01:30', 'America/Chicago')).toBe(
			utc('2026-03-08T07:30:00Z') // still CST
		);
		expect(wallClockToInstant('2026-03-08T03:30', 'America/Chicago')).toBe(
			utc('2026-03-08T08:30:00Z') // now CDT
		);
	});
});

describe('layoverMinutes', () => {
	it('measures the Doha connection on the way out', () => {
		// Lands 21:05 Doha, leaves 02:10 Doha the next morning.
		expect(layoverMinutes(dfwToDoh, dohToIsb)).toBe(305);
		expect(formatDurationMinutes(305)).toBe('5h 5m');
	});

	it('measures the Doha connection on the way home', () => {
		expect(layoverMinutes(isbToDoh, dohToDfw)).toBe(130);
	});

	it('returns null when the first leg has no arrival zone', () => {
		expect(layoverMinutes({ ...dfwToDoh, arrivalTimeZone: undefined }, dohToIsb)).toBeNull();
	});

	it('returns null when the second leg has no departure zone', () => {
		expect(layoverMinutes(dfwToDoh, { ...dohToIsb, departureTimeZone: undefined })).toBeNull();
	});
});

describe('totalTravelMinutes', () => {
	it('adds up to legs plus layovers on the outbound', () => {
		const outbound = [dfwToDoh, dohToIsb];
		expect(totalTravelMinutes(outbound)).toBe(1405); // 23h 25m
		expect(870 + 305 + 230).toBe(1405);
	});

	it('adds up on the return', () => {
		expect(totalTravelMinutes([isbToDoh, dohToDfw])).toBe(1355); // 22h 35m
		expect(250 + 130 + 975).toBe(1355);
	});

	it('sorts by order before reading the endpoints', () => {
		expect(totalTravelMinutes([dohToIsb, dfwToDoh])).toBe(1405);
	});

	it('still answers when only a MIDDLE leg is missing its zones', () => {
		// The middle leg's own duration is unknowable, but door-to-door only
		// needs the first departure and the last arrival.
		const middle: Leg = {
			...dohToIsb,
			order: 1,
			arrivalAirport: 'AUH',
			arrivalAt: '2026-12-07T04:00',
			arrivalTimeZone: undefined
		};
		const last: Leg = {
			...dohToIsb,
			order: 2,
			departureAirport: 'AUH',
			departureAt: '2026-12-07T05:00',
			departureTimeZone: undefined
		};
		const legs = [dfwToDoh, middle, last];
		expect(legDurationMinutes(middle)).toBeNull();
		expect(totalTravelMinutes(legs)).toBe(1405);
	});

	it('returns null when an endpoint zone is missing, and on an empty direction', () => {
		expect(
			totalTravelMinutes([{ ...dfwToDoh, departureTimeZone: undefined }, dohToIsb])
		).toBeNull();
		expect(totalTravelMinutes([dfwToDoh, { ...dohToIsb, arrivalTimeZone: undefined }])).toBeNull();
		expect(totalTravelMinutes([])).toBeNull();
	});
});

describe('calendar day offset', () => {
	it('flags the overnight DFW->DOH leg as +1', () => {
		expect(calendarDayOffset(dfwToDoh)).toBe(1);
		expect(arrivesNextDay(dfwToDoh)).toBe(true);
	});

	it('leaves the same-day legs unflagged', () => {
		expect(calendarDayOffset(dohToIsb)).toBe(0);
		expect(arrivesNextDay(dohToIsb)).toBe(false);
		// Sixteen hours in the air and it still lands the same calendar date.
		expect(calendarDayOffset(dohToDfw)).toBe(0);
		expect(arrivesNextDay(dohToDfw)).toBe(false);
	});

	it('reports -1 flying back across the date line', () => {
		const hndToLax: ItineraryLeg = {
			direction: 'return',
			order: 0,
			departureAt: '2026-12-20T00:30', // Sun, Tokyo
			arrivalAt: '2026-12-19T17:30', // Sat, Los Angeles
			departureTimeZone: 'Asia/Tokyo',
			arrivalTimeZone: 'America/Los_Angeles'
		};
		expect(calendarDayOffset(hndToLax)).toBe(-1);
		expect(arrivesNextDay(hndToLax)).toBe(false);
		expect(legDurationMinutes(hndToLax)).toBe(600); // 10h, really forward in time
	});

	it('needs no zones at all — the badge still renders on a half-entered leg', () => {
		const zoneless = {
			...dfwToDoh,
			departureTimeZone: undefined,
			arrivalTimeZone: undefined
		};
		expect(calendarDayOffset(zoneless)).toBe(1);
		expect(arrivesNextDay(zoneless)).toBe(true);
		expect(legDurationMinutes(zoneless)).toBeNull();
	});

	it('handles a month and a year boundary', () => {
		expect(
			calendarDayOffset({
				...dfwToDoh,
				departureAt: '2026-12-31T23:00',
				arrivalAt: '2027-01-01T14:00'
			})
		).toBe(1);
		expect(
			calendarDayOffset({
				...dfwToDoh,
				departureAt: '2026-11-30T23:00',
				arrivalAt: '2026-12-02T14:00'
			})
		).toBe(2);
	});

	it('returns null when a wall clock is unusable', () => {
		expect(calendarDayOffset({ ...dfwToDoh, arrivalAt: '' })).toBeNull();
		expect(arrivesNextDay({ ...dfwToDoh, arrivalAt: '' })).toBe(false);
	});
});

describe('hasDeparted', () => {
	it('answers against a real instant, not the viewer clock reading', () => {
		const beforeTakeoff = utc('2026-12-06T03:34:00Z');
		const afterTakeoff = utc('2026-12-06T03:36:00Z');
		expect(hasDeparted(dfwToDoh, beforeTakeoff)).toBe(false);
		expect(hasDeparted(dfwToDoh, afterTakeoff)).toBe(true);
	});

	it('says "cannot know" rather than "no" when the zone is absent', () => {
		expect(hasDeparted({ ...dfwToDoh, departureTimeZone: undefined }, Date.now())).toBeNull();
	});
});

describe('sorting', () => {
	it('orders legs within a direction', () => {
		expect(sortLegsByOrder([dohToIsb, dfwToDoh]).map((l) => l.flightNumber)).toEqual([
			'730',
			'632'
		]);
	});

	it('orders outbound before return for display', () => {
		const shuffled = [dohToDfw, dohToIsb, isbToDoh, dfwToDoh];
		expect(sortLegsForDisplay(shuffled).map((l) => l.flightNumber)).toEqual([
			'730',
			'632',
			'633',
			'729'
		]);
	});

	it('does not mutate its input', () => {
		const input = [dohToIsb, dfwToDoh];
		sortLegsForDisplay(input);
		sortLegsByOrder(input);
		expect(input.map((l) => l.flightNumber)).toEqual(['632', '730']);
	});

	it('builds the airport pickup list by real arrival instant', () => {
		// Maria comes in on her own flight, landing at ISB before the group.
		const mariaIsb: Leg = {
			direction: 'outbound',
			order: 1,
			airline: 'EK',
			flightNumber: '614',
			departureAirport: 'DXB',
			arrivalAirport: 'ISB',
			departureAt: '2026-12-07T04:30',
			arrivalAt: '2026-12-07T09:15', // 04:15Z — Karachi, AFTER the group's 03:00Z
			departureTimeZone: 'Asia/Dubai',
			arrivalTimeZone: 'Asia/Karachi'
		};
		const arrivals = sortLegsByArrivalInstant([mariaIsb, dohToIsb, dfwToDoh]);
		expect(arrivals.map((l) => l.flightNumber)).toEqual(['730', '632', '614']);
	});

	it('parks zoneless legs at the end in their original order', () => {
		const unknownA: Leg = { ...dohToIsb, flightNumber: 'A1', arrivalTimeZone: undefined };
		const unknownB: Leg = { ...dohToIsb, flightNumber: 'B2', arrivalTimeZone: undefined };
		const sorted = sortLegsByArrivalInstant([unknownA, dohToIsb, unknownB, dfwToDoh]);
		expect(sorted.map((l) => l.flightNumber)).toEqual(['730', '632', 'A1', 'B2']);
	});
});

describe('effectiveItinerary', () => {
	it('gives an attendee with no legs of their own the group itinerary', () => {
		const itinerary = effectiveItinerary(groupLegs, []);
		expect(itinerary.outbound.map((l) => l.flightNumber)).toEqual(['730', '632']);
		expect(itinerary.return.map((l) => l.flightNumber)).toEqual(['633', '729']);
		expect(itinerary.legs).toHaveLength(4);
		expect(itinerary.outboundSource).toBe('group');
		expect(itinerary.returnSource).toBe('group');
	});

	it('replaces only the direction the attendee actually covers', () => {
		// Maria joins from Dubai on the way out, then flies home with everyone.
		const mariaOutbound: Leg = {
			direction: 'outbound',
			order: 0,
			airline: 'EK',
			flightNumber: '614',
			departureAirport: 'DXB',
			arrivalAirport: 'ISB',
			departureAt: '2026-12-07T04:30',
			arrivalAt: '2026-12-07T09:15',
			departureTimeZone: 'Asia/Dubai',
			arrivalTimeZone: 'Asia/Karachi'
		};

		const itinerary = effectiveItinerary(groupLegs, [mariaOutbound]);
		expect(itinerary.outbound.map((l) => l.flightNumber)).toEqual(['614']);
		expect(itinerary.outboundSource).toBe('attendee');
		// Her return is untouched — still the group's two legs.
		expect(itinerary.return.map((l) => l.flightNumber)).toEqual(['633', '729']);
		expect(itinerary.returnSource).toBe('group');
		expect(itinerary.legs.map((l) => l.flightNumber)).toEqual(['614', '633', '729']);
	});

	it('replaces a direction wholesale even when the leg counts differ', () => {
		// Sam stays a week longer and comes home on one nonstop instead of two
		// legs. Overriding by `order` would leave the group's DOH->DFW attached.
		const samReturn: Leg = {
			direction: 'return',
			order: 0,
			airline: 'PK',
			flightNumber: '785',
			departureAirport: 'ISB',
			arrivalAirport: 'JFK',
			departureAt: '2026-12-26T07:30',
			arrivalAt: '2026-12-26T13:45',
			departureTimeZone: 'Asia/Karachi',
			arrivalTimeZone: 'America/New_York'
		};

		const itinerary = effectiveItinerary(groupLegs, [samReturn]);
		expect(itinerary.return.map((l) => l.flightNumber)).toEqual(['785']);
		expect(itinerary.returnSource).toBe('attendee');
		expect(itinerary.outbound.map((l) => l.flightNumber)).toEqual(['730', '632']);
		expect(itinerary.legs).toHaveLength(3);
	});

	it("sorts an attendee's own legs by order", () => {
		const first: Leg = { ...dfwToDoh, order: 0, flightNumber: 'X1' };
		const second: Leg = { ...dohToIsb, order: 1, flightNumber: 'X2' };
		const itinerary = effectiveItinerary(groupLegs, [second, first]);
		expect(itinerary.outbound.map((l) => l.flightNumber)).toEqual(['X1', 'X2']);
	});

	it('reports "none" for a direction nobody has entered yet', () => {
		const outboundOnly = groupLegs.filter((l) => l.direction === 'outbound');
		const itinerary = effectiveItinerary(outboundOnly, []);
		expect(itinerary.return).toEqual([]);
		expect(itinerary.returnSource).toBe('none');
		expect(itinerary.outboundSource).toBe('group');
	});

	it('works with no group legs at all', () => {
		const empty = effectiveItinerary<Leg>([], []);
		expect(empty.legs).toEqual([]);
		expect(empty.outboundSource).toBe('none');
		expect(empty.returnSource).toBe('none');
	});

	it("preserves the caller's own fields on the legs it returns", () => {
		const itinerary = effectiveItinerary(groupLegs, []);
		expect(itinerary.outbound[0].departureAirport).toBe('DFW');
		expect(itinerary.outbound[0].airline).toBe('QR');
	});
});

describe('summarizeDirection', () => {
	const outbound = summarizeDirection([dohToIsb, dfwToDoh]);

	it('lays out every timing the panel renders, in order', () => {
		expect(outbound.legs.map((t) => t.leg.flightNumber)).toEqual(['730', '632']);
		expect(outbound.legs[0].durationMinutes).toBe(870);
		expect(outbound.legs[0].layoverBeforeMinutes).toBeNull();
		expect(outbound.legs[0].calendarDayOffset).toBe(1);
		expect(outbound.legs[0].arrivesNextDay).toBe(true);

		expect(outbound.legs[1].durationMinutes).toBe(230);
		expect(outbound.legs[1].layoverBeforeMinutes).toBe(305);
		expect(outbound.legs[1].arrivesNextDay).toBe(false);
	});

	it('reconciles: legs + layovers == door-to-door', () => {
		const flying = outbound.legs.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0);
		expect(flying + (outbound.totalLayoverMinutes ?? 0)).toBe(outbound.totalTravelMinutes);
		expect(outbound.totalLayoverMinutes).toBe(305);
		expect(outbound.hasMissingZones).toBe(false);
	});

	it('has no layover total on a single-leg direction', () => {
		const single = summarizeDirection([dfwToDoh]);
		expect(single.totalLayoverMinutes).toBeNull();
		expect(single.totalTravelMinutes).toBe(870);
	});

	it('flags missing zones and nulls only what it cannot know', () => {
		const partial = summarizeDirection([dfwToDoh, { ...dohToIsb, departureTimeZone: undefined }]);
		expect(partial.hasMissingZones).toBe(true);
		expect(partial.legs[0].durationMinutes).toBe(870);
		expect(partial.legs[1].durationMinutes).toBeNull();
		expect(partial.legs[1].layoverBeforeMinutes).toBeNull();
		expect(partial.totalLayoverMinutes).toBeNull();
		// Both endpoints still resolve, so door-to-door survives.
		expect(partial.totalTravelMinutes).toBe(1405);
		// And the +1 badge never depended on a zone.
		expect(partial.legs[0].arrivesNextDay).toBe(true);
	});

	it('handles an empty direction', () => {
		const none = summarizeDirection<Leg>([]);
		expect(none.legs).toEqual([]);
		expect(none.totalTravelMinutes).toBeNull();
		expect(none.totalLayoverMinutes).toBeNull();
		expect(none.hasMissingZones).toBe(false);
	});
});

describe('formatDurationMinutes', () => {
	it('renders hours and minutes', () => {
		expect(formatDurationMinutes(870)).toBe('14h 30m');
		expect(formatDurationMinutes(180)).toBe('3h');
		expect(formatDurationMinutes(45)).toBe('45m');
		expect(formatDurationMinutes(0)).toBe('0m');
		expect(formatDurationMinutes(60)).toBe('1h');
		expect(formatDurationMinutes(-70)).toBe('-1h 10m');
	});
});
