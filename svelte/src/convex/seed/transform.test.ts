import { describe, expect, it } from 'vitest';

import {
	buildAttributes,
	resolveFamilyName,
	routeFamilyLink,
	type FamilyRow,
	type ProfileRow
} from './transform';

const family = (over: Partial<FamilyRow>): FamilyRow => ({
	number: 'P-001',
	raw_name: 'Example',
	note: '',
	link: '',
	debt: null,
	fixed: {},
	grand_total: null,
	milestones: {},
	sponsor: { name: null, email: null, phone: null },
	row: 1,
	family_name: 'The Example family',
	name_extra: [],
	template_version: null,
	...over
});

const profile = (over: Partial<ProfileRow>): ProfileRow => ({
	number: 'P-001',
	status: null,
	family_name: null,
	years_enslaved: null,
	reason: null,
	religion: null,
	members: [],
	photo: null,
	...over
});

describe('routeFamilyLink', () => {
	it('routes a Managed Missions URL to managed_missions_link', () => {
		expect(routeFamilyLink('https://example.managedmissions.com/Trip/12345')).toEqual({
			field: 'managed_missions_link',
			url: 'https://example.managedmissions.com/Trip/12345',
			host: 'example.managedmissions.com'
		});
	});

	it('matches the bare apex host too', () => {
		const routed = routeFamilyLink('http://managedmissions.com/x');
		expect(routed?.field).toBe('managed_missions_link');
	});

	it('matches on a domain boundary, so a look-alike host is not Managed Missions', () => {
		const routed = routeFamilyLink('https://notmanagedmissions.com/x');
		expect(routed?.field).toBe('payment_link');
		expect(routed?.host).toBe('notmanagedmissions.com');
	});

	it('routes any other URL to payment_link rather than dropping it', () => {
		expect(routeFamilyLink('https://checkout.example.org/pay/1')).toEqual({
			field: 'payment_link',
			url: 'https://checkout.example.org/pay/1',
			host: 'checkout.example.org'
		});
	});

	it('is case-insensitive about the scheme and the host', () => {
		const routed = routeFamilyLink('HTTPS://WWW.ManagedMissions.COM/x');
		expect(routed?.field).toBe('managed_missions_link');
		expect(routed?.host).toBe('www.managedmissions.com');
	});

	it('trims surrounding whitespace before testing', () => {
		expect(routeFamilyLink('  https://a.managedmissions.com/x  ')?.url).toBe(
			'https://a.managedmissions.com/x'
		);
	});

	it('returns null for values that are not URLs', () => {
		expect(routeFamilyLink('Pebbles / The Joneses')).toBeNull();
		expect(routeFamilyLink('no link')).toBeNull();
		expect(routeFamilyLink('Some Organization')).toBeNull();
		expect(routeFamilyLink('www.example.com/pay')).toBeNull();
	});

	it('returns null for a missing or empty value', () => {
		expect(routeFamilyLink(undefined)).toBeNull();
		expect(routeFamilyLink(null)).toBeNull();
		expect(routeFamilyLink('')).toBeNull();
		expect(routeFamilyLink('   ')).toBeNull();
	});

	it('returns null for a url-looking string that will not parse', () => {
		expect(routeFamilyLink('https://')).toBeNull();
	});
});

describe('buildAttributes link fields', () => {
	it('omits both link keys when there is no link', () => {
		const attrs = buildAttributes(profile({ religion: 'Christian' }), '');
		expect(attrs).toEqual({ religion: 'Christian' });
		expect('managed_missions_link' in attrs).toBe(false);
		expect('payment_link' in attrs).toBe(false);
	});

	it('omits both link keys when the link is not a URL', () => {
		expect(buildAttributes(undefined, 'Some Name')).toEqual({});
	});

	it('sets managed_missions_link for a Managed Missions URL', () => {
		expect(buildAttributes(undefined, 'https://x.managedmissions.com/Trip/1')).toEqual({
			managed_missions_link: 'https://x.managedmissions.com/Trip/1'
		});
	});

	it('sets payment_link for any other URL', () => {
		expect(buildAttributes(undefined, 'https://pay.example.org/abc')).toEqual({
			payment_link: 'https://pay.example.org/abc'
		});
	});

	it('leaves the pre-existing profile attributes untouched', () => {
		const attrs = buildAttributes(
			profile({ years_enslaved: 12, reason: 'Medical debt', religion: 'Christia' }),
			'https://x.managedmissions.com/Trip/1'
		);
		expect(attrs).toEqual({
			years_enslaved: 12,
			reason_for_enslavement: 'Medical debt',
			religion: 'Christian',
			managed_missions_link: 'https://x.managedmissions.com/Trip/1'
		});
	});
});

describe('resolveFamilyName still owns the non-URL link cells', () => {
	it('uses a non-URL link as the name when raw_name is empty, and sets no link field', () => {
		const row = family({ raw_name: '', link: 'Pebbles / The Joneses' });
		expect(resolveFamilyName(row)).toBe('Pebbles');
		expect(buildAttributes(undefined, row.link)).toEqual({});
	});

	it('never treats a URL as a name', () => {
		const row = family({ raw_name: '', link: 'https://x.managedmissions.com/Trip/1' });
		expect(resolveFamilyName(row)).toBe('The Example family');
		expect(buildAttributes(undefined, row.link)).toEqual({
			managed_missions_link: 'https://x.managedmissions.com/Trip/1'
		});
	});
});
