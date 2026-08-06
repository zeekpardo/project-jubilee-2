// Trip display helpers. Nothing here computes with a flight time — that lives
// in `lib/domain/trip-itinerary.ts` and this module never duplicates it.

/**
 * A trip's dates, rendered from the STORED ISO calendar days verbatim.
 *
 * `startOn` / `endOn` are `YYYY-MM-DD` for the same reason `tasks.dueOn` is: a
 * trip that runs Dec 1–14 runs those days for everyone reading the page. So
 * they are printed as stored and never passed through `new Date()`, which would
 * shift the day west of Greenwich — the exact bug the storage choice avoids.
 */
export function formatTripDateRange(startOn: string, endOn: string): string {
	return startOn === endOn ? startOn : `${startOn} – ${endOn}`;
}

/**
 * The §15 prefill: `{Campaign} — {Project} — {startOn}`, falling back to
 * `{Campaign} — {startOn}` when no record is picked.
 *
 * PREFILL, never overwrite. The create dialog stops calling this the moment the
 * user types in the name field — the name is theirs from then on, the same
 * contract `updates.slug` has and for the same reason: a handle that silently
 * rewrites itself is not a handle.
 */
export function tripNamePrefill(input: {
	campaignName: string;
	projectName?: string | null;
	startOn: string;
}): string {
	return [input.campaignName, input.projectName || null, input.startOn]
		.filter((part): part is string => Boolean(part && part.trim()))
		.join(' — ');
}

/** `DFW → DOH`, or as much of it as the leg carries. */
export function formatLegRoute(
	departureAirport: string | null | undefined,
	arrivalAirport: string | null | undefined
): string {
	const from = departureAirport?.trim();
	const to = arrivalAirport?.trim();
	if (from && to) return `${from} → ${to}`;
	return from || to || '';
}

/** `QR 51` — airline and flight number as one readable label. */
export function formatFlightLabel(airline: string, flightNumber: string): string {
	return [airline.trim(), flightNumber.trim()].filter(Boolean).join(' ');
}
