import { describe, expect, it } from 'vitest';

import {
	DEFAULT_PUBLIC_COUNT_THRESHOLD,
	DEFAULT_PUBLIC_POLICY,
	resolvePublicPolicy
} from './public-policy';
import { isProtectedFieldKey, publicAttributeList } from './field-definitions';
import type { FieldDefinition } from './field-definitions';

describe('resolvePublicPolicy', () => {
	it('falls back to the shipped defaults for an org that has set nothing', () => {
		expect(resolvePublicPolicy(undefined)).toEqual(DEFAULT_PUBLIC_POLICY);
		expect(resolvePublicPolicy({})).toEqual(DEFAULT_PUBLIC_POLICY);
	});

	it('fails STRICT on a missing settings row, not open', () => {
		// The wall must be at its most cautious when it knows least.
		expect(resolvePublicPolicy(null).countThreshold).toBe(DEFAULT_PUBLIC_COUNT_THRESHOLD);
	});

	it('takes the org threshold, including zero', () => {
		expect(resolvePublicPolicy({ publicCountThreshold: 10 }).countThreshold).toBe(10);
		expect(resolvePublicPolicy({ publicCountThreshold: 0 }).countThreshold).toBe(0);
	});

	it('ignores a nonsensical threshold rather than trusting it', () => {
		expect(resolvePublicPolicy({ publicCountThreshold: -3 }).countThreshold).toBe(
			DEFAULT_PUBLIC_COUNT_THRESHOLD
		);
		expect(resolvePublicPolicy({ publicCountThreshold: NaN }).countThreshold).toBe(
			DEFAULT_PUBLIC_COUNT_THRESHOLD
		);
	});

	it('trims and drops blank protected keys', () => {
		expect(
			resolvePublicPolicy({ protectedFieldKeys: ['  partner_ref ', '', '   ', 'case_worker'] })
				.extraProtectedKeys
		).toEqual(['partner_ref', 'case_worker']);
	});
});

describe('isProtectedFieldKey with org additions', () => {
	it('still protects the shared list with no additions', () => {
		expect(isProtectedFieldKey('site_ref')).toBe(true);
		expect(isProtectedFieldKey('home_address')).toBe(true);
	});

	it('protects an org key that the shared list would allow', () => {
		expect(isProtectedFieldKey('case_worker')).toBe(false);
		expect(isProtectedFieldKey('case_worker', ['case_worker'])).toBe(true);
	});

	it('matches an org key case-insensitively, like the shared ones', () => {
		expect(isProtectedFieldKey('  Case_Worker ', ['case_worker'])).toBe(true);
	});

	it('cannot SHORTEN the shared list — an org may only tighten', () => {
		// Passing a shared key as an "extra" is a no-op; nothing removes one.
		expect(isProtectedFieldKey('site_ref', [])).toBe(true);
	});
});

describe('publicAttributeList with org additions', () => {
	const def = (key: string): FieldDefinition => ({
		id: key,
		entity: 'project',
		scope: 'org',
		campaignId: null,
		categoryId: null,
		key,
		label: key,
		type: 'text',
		options: null,
		order: 0,
		isPublic: true,
		isRequired: false
	});

	it('drops an org-protected key even though its definition says public', () => {
		const defs = [def('case_worker'), def('religion')];
		const attributes = { case_worker: 'Amina', religion: 'Christian' };

		expect(publicAttributeList(defs, attributes).map((a) => a.key)).toEqual([
			'case_worker',
			'religion'
		]);
		expect(publicAttributeList(defs, attributes, ['case_worker']).map((a) => a.key)).toEqual([
			'religion'
		]);
	});
});
