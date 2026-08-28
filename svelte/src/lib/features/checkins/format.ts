// Pure display helpers. Nothing here decides anything about a conversation —
// the objective rules live in $lib/domain/checkin-objectives.ts and this module
// never duplicates them, the same rule features/trips/format.ts states.

/**
 * A clock time for a bubble: "2:34 pm".
 *
 * Deliberately paired with `messageDayLabel` below rather than used alone. The
 * reference messenger this borrows from shows time-of-day and never a date,
 * which is fine for a chat you opened this morning and wrong for a check-in
 * that runs for three weeks.
 */
export function messageTime(at: number): string {
	return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** The day heading a run of messages sits under. */
export function messageDayLabel(at: number): string {
	const date = new Date(at);
	const today = new Date();
	const sameDay = (a: Date, b: Date) =>
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate();

	if (sameDay(date, today)) return 'Today';
	const yesterday = new Date(today);
	yesterday.setDate(today.getDate() - 1);
	if (sameDay(date, yesterday)) return 'Yesterday';

	return date.toLocaleDateString(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' })
	});
}

/** The unambiguous instant, for a `title` attribute. Hover beats guessing. */
export function absoluteTimestamp(at: number): string {
	return new Date(at).toLocaleString();
}

/** True when these two messages should be separated by a day heading. */
export function startsNewDay(at: number, previousAt: number | undefined): boolean {
	if (previousAt === undefined) return true;
	const a = new Date(at);
	const b = new Date(previousAt);
	return (
		a.getFullYear() !== b.getFullYear() ||
		a.getMonth() !== b.getMonth() ||
		a.getDate() !== b.getDate()
	);
}

/** Short relative age for a list row: "now", "5m", "3h", "2d", then a date. */
export function relativeAge(at: number, now: number): string {
	const seconds = Math.max(0, Math.round((now - at) / 1000));
	if (seconds < 45) return 'now';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.round(hours / 24);
	if (days < 7) return `${days}d`;
	return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** 0..1 as a whole percentage, for a rating or a confidence. */
export function asPercent(value: number): string {
	return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}
