import { describe, expect, it } from 'vitest';
import {
	AMBIGUOUS_ROLES,
	guessMemberSide,
	isMemberSideSuspect,
	normalizeRoleToken,
	SERVED_ROLES,
	TEAM_SUSPECT_ROLES
} from './member-side-audit';

describe('normalizeRoleToken', () => {
	it('folds case and trims', () => {
		expect(normalizeRoleToken('  Volunteer ')).toBe('volunteer');
		expect(normalizeRoleToken('STAFF')).toBe('staff');
	});

	it('collapses every separator anyone types into one underscore', () => {
		expect(normalizeRoleToken('Team Lead')).toBe('team_lead');
		expect(normalizeRoleToken('team-lead')).toBe('team_lead');
		expect(normalizeRoleToken('team.lead')).toBe('team_lead');
		expect(normalizeRoleToken('team   lead')).toBe('team_lead');
		expect(normalizeRoleToken('team__lead')).toBe('team_lead');
	});

	it('drops leading and trailing separators', () => {
		expect(normalizeRoleToken('_leader_')).toBe('leader');
		expect(normalizeRoleToken('- staff -')).toBe('staff');
	});

	it('reduces a role that is only punctuation to nothing', () => {
		expect(normalizeRoleToken('   ')).toBe('');
		expect(normalizeRoleToken('---')).toBe('');
	});
});

describe('guessMemberSide', () => {
	it('flags the vocabulary the schema comment itself names as the serving side', () => {
		expect(guessMemberSide('team_lead')).toBe('likely-team');
		expect(guessMemberSide('leader')).toBe('likely-team');
		expect(guessMemberSide('volunteer')).toBe('likely-team');
		expect(guessMemberSide('staff')).toBe('likely-team');
	});

	it('flags the same words however they were typed', () => {
		expect(guessMemberSide('Team Lead')).toBe('likely-team');
		expect(guessMemberSide('TEAM-LEAD')).toBe('likely-team');
		expect(guessMemberSide('  Volunteer  ')).toBe('likely-team');
		expect(guessMemberSide('Team Member')).toBe('likely-team');
	});

	it('reads a plural as its singular, because a list header gets pasted into a field', () => {
		expect(guessMemberSide('Volunteers')).toBe('likely-team');
		expect(guessMemberSide('leaders')).toBe('likely-team');
	});

	// The whole point of the three-way answer. `attendee` is IN the schema's own
	// role vocabulary and describes the family attending a session as naturally
	// as the person who flew in to run it.
	it('refuses to guess at an ambiguous word', () => {
		expect(guessMemberSide('attendee')).toBe('unknown');
		expect(guessMemberSide('Attendee')).toBe('unknown');
		expect(guessMemberSide('attendees')).toBe('unknown');
		for (const role of AMBIGUOUS_ROLES) {
			expect(guessMemberSide(role)).toBe('unknown');
		}
	});

	it('recognises the served side rather than lumping it in with the unknown', () => {
		expect(guessMemberSide('member')).toBe('likely-served');
		expect(guessMemberSide('Beneficiary')).toBe('likely-served');
		for (const role of SERVED_ROLES) {
			expect(guessMemberSide(role)).toBe('likely-served');
		}
	});

	// `role` is free text on purpose, so this is the COMMON answer, not a bug.
	it('says nothing about a vocabulary it has never heard of', () => {
		expect(guessMemberSide('Site Coordinator')).toBe('unknown');
		expect(guessMemberSide('mentor')).toBe('unknown');
		expect(guessMemberSide('رضاکار')).toBe('unknown');
		expect(guessMemberSide('')).toBe('unknown');
		expect(guessMemberSide('   ')).toBe('unknown');
	});

	// Donors are already excluded from every count by DONOR_ROLES in
	// campaign-stats.ts, so they need no correction and must not be proposed.
	it('leaves donor roles alone — they are already excluded from the counts', () => {
		expect(guessMemberSide('donor')).toBe('unknown');
		expect(guessMemberSide('sponsor')).toBe('unknown');
	});

	it('classifies every listed team role as team', () => {
		for (const role of TEAM_SUSPECT_ROLES) {
			expect(guessMemberSide(role)).toBe('likely-team');
		}
	});
});

describe('isMemberSideSuspect', () => {
	it('proposes a team-looking row that nobody has answered for', () => {
		expect(isMemberSideSuspect({ role: 'volunteer' })).toBe(true);
		expect(isMemberSideSuspect({ role: 'Team Lead', side: null })).toBe(true);
	});

	it('never proposes a row someone has already answered for', () => {
		expect(isMemberSideSuspect({ role: 'volunteer', side: 'team' })).toBe(false);
		// Even against the heuristic: an explicit `served` on a role reading
		// "leader" is a decision, and a heuristic does not get to reopen it.
		expect(isMemberSideSuspect({ role: 'leader', side: 'served' })).toBe(false);
	});

	it('proposes neither the served side nor a word it does not know', () => {
		expect(isMemberSideSuspect({ role: 'member' })).toBe(false);
		expect(isMemberSideSuspect({ role: 'attendee' })).toBe(false);
		expect(isMemberSideSuspect({ role: 'Site Coordinator' })).toBe(false);
	});
});
