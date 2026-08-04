// ============================================================
// Member-side audit — a heuristic that PROPOSES, a human DISPOSES
// ============================================================
// `projectMembers.side` arrived after the rows did. Every row written before
// it reads as `served` (see the schema comment), which is the only safe
// default: reading them as `team` would have silently dropped people out of an
// already-published impact number.
//
// But some of those rows are obviously not the family. A row whose role says
// `volunteer` or `team_lead` is the organization's own person, and today it is
// counted in the campaign's published `people_reached` AND in the household
// size published on a family's public project page.
//
// This module is the SUSPECT LIST for that correction, and nothing more.
//
// It is a HEURISTIC over free text, and free text is exactly what
// `projectMembers.role` is — the schema says so, on purpose, so a campaign can
// use its own vocabulary. So this cannot be right, only useful:
//
//   - It will MISS roles it has never heard of. "Site Coordinator", "Mentor",
//     and every word a particular org invented are `unknown` here, and the
//     plan is emphatic that no code should have to recognize them.
//   - It will occasionally be WRONG. An org that calls the head of a household
//     "leader" would see that row proposed as team, and it is not.
//
// Which is why nothing in this codebase acts on it. The report it feeds writes
// nothing; an admin reads the suspect rows next to the before/after number the
// correction would produce, and decides. See PLAN-trips.md §13.
// ============================================================

/** Which side of the work a role STRING suggests. A suggestion, not a fact. */
export type MemberSideGuess = 'likely-team' | 'likely-served' | 'unknown';

/**
 * Roles that describe the organization's own people.
 *
 * Deliberately small and grounded: these are the words the schema's own
 * comment on `projectMembers.role` names (`team_lead | leader | volunteer`),
 * plus `staff`, plus the shapes those same words take when typed by hand.
 * Nothing is here because it "sounds like" the team.
 */
export const TEAM_SUSPECT_ROLES: readonly string[] = [
	'team',
	'team_lead',
	'team_leader',
	'team_member',
	'lead',
	'leader',
	'volunteer',
	'staff'
];

/**
 * Roles that describe the people a record exists for.
 *
 * `member` is the load-bearing one: campaign-stats.ts records that every family
 * member carries the constant `member` here, with the real relationship in the
 * attributes bag. These are listed so the report can say "we looked and this
 * one is fine", not to drive any write.
 */
export const SERVED_ROLES: readonly string[] = ['member', 'beneficiary', 'recipient'];

/**
 * Words that read like one side and mean either, and are therefore NEVER
 * proposed. `attendee` is the sharp one: it is in the schema's own role
 * vocabulary and it describes the family attending a session just as naturally
 * as the person who flew in to run it. A heuristic that guessed here would
 * move a published number on a coin toss.
 */
export const AMBIGUOUS_ROLES: readonly string[] = ['attendee', 'participant', 'guest', 'other'];

const TEAM = new Set(TEAM_SUSPECT_ROLES);
const SERVED = new Set(SERVED_ROLES);
const AMBIGUOUS = new Set(AMBIGUOUS_ROLES);

/**
 * The comparable form of a hand-typed role: case folded, and every separator
 * anyone reaches for — space, hyphen, dot, repeated underscores — collapsed to
 * one underscore. "Team Lead", "team-lead" and "TEAM_LEAD" are one word.
 */
export function normalizeRoleToken(role: string): string {
	return role
		.trim()
		.toLowerCase()
		.replace(/[\s._-]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

/** "volunteers" -> "volunteer". Only consulted when the plural itself is unknown. */
function singular(token: string): string | null {
	return token.length > 3 && token.endsWith('s') && !token.endsWith('ss')
		? token.slice(0, -1)
		: null;
}

function lookup(token: string): MemberSideGuess | null {
	if (AMBIGUOUS.has(token)) return 'unknown';
	if (TEAM.has(token)) return 'likely-team';
	if (SERVED.has(token)) return 'likely-served';
	return null;
}

/**
 * Which side this role SUGGESTS, or `unknown` when it suggests nothing.
 *
 * `unknown` is the expected answer, not the failure case: the column is free
 * text and most orgs will have their own vocabulary in it. Only `likely-team`
 * ever puts a row in front of an admin.
 */
export function guessMemberSide(role: string): MemberSideGuess {
	const token = normalizeRoleToken(role);
	if (!token) return 'unknown';

	const direct = lookup(token);
	if (direct) return direct;

	const stem = singular(token);
	return stem ? (lookup(stem) ?? 'unknown') : 'unknown';
}

/** The shape the audit needs off a `projectMembers` row. */
export interface MemberSideCandidate {
	role: string;
	side?: 'served' | 'team' | null;
}

/**
 * Whether this row belongs on the report.
 *
 * A row that already carries an explicit `side` is NEVER suspect, whichever
 * value it carries and whatever its role says. Someone answered this question
 * on purpose; a heuristic does not get to reopen it.
 */
export function isMemberSideSuspect(row: MemberSideCandidate): boolean {
	if (row.side) return false;
	return guessMemberSide(row.role) === 'likely-team';
}
