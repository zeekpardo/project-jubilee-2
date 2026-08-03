import { describe, expect, it } from 'vitest';

import { decideSiteViewer, type SiteViewerContact } from './site-viewer';

const contact = (over: Partial<SiteViewerContact> = {}): SiteViewerContact => ({
	_id: 'contact1',
	orgId: 'org1',
	portalAccess: 'active',
	...over
});

describe('decideSiteViewer', () => {
	describe('refusals', () => {
		it('refuses an unknown slug even when the person and their contact are real', () => {
			expect(decideSiteViewer({ orgId: null, userId: 'user1', contact: contact() })).toBeNull();
		});

		it('refuses a signed-out visitor at an org that exists', () => {
			expect(decideSiteViewer({ orgId: 'org1', userId: null, contact: contact() })).toBeNull();
		});

		it('refuses when neither the slug nor the session resolved', () => {
			expect(decideSiteViewer({ orgId: null, userId: null, contact: null })).toBeNull();
		});

		it('refuses a signed-in person with no contact in this org, which is the visitor from elsewhere', () => {
			expect(decideSiteViewer({ orgId: 'org1', userId: 'user1', contact: null })).toBeNull();
		});

		it('refuses a contact whose access was withdrawn', () => {
			expect(
				decideSiteViewer({
					orgId: 'org1',
					userId: 'user1',
					contact: contact({ portalAccess: 'revoked' })
				})
			).toBeNull();
		});

		// The index should make this unreachable. It is asserted anyway because a
		// pure function that trusts its caller queried correctly is a widening
		// waiting for a caller that did not.
		it('refuses a contact belonging to a different org than the slug named', () => {
			expect(
				decideSiteViewer({
					orgId: 'org1',
					userId: 'user1',
					contact: contact({ orgId: 'org2' })
				})
			).toBeNull();
		});

		it('refuses a still-invited contact, because a linked row that is not active is two writes disagreeing', () => {
			expect(
				decideSiteViewer({
					orgId: 'org1',
					userId: 'user1',
					contact: contact({ portalAccess: 'invited' })
				})
			).toBeNull();
		});

		// Separate from the 'invited' case on purpose: never written and written
		// to 'invited' are different states in the schema, even though the answer
		// here is the same.
		it('refuses a contact that was never given portal access at all', () => {
			expect(
				decideSiteViewer({
					orgId: 'org1',
					userId: 'user1',
					contact: contact({ portalAccess: undefined })
				})
			).toBeNull();
		});

		it('still refuses when an unknown slug and a revoked contact arrive together', () => {
			expect(
				decideSiteViewer({
					orgId: null,
					userId: 'user1',
					contact: contact({ portalAccess: 'revoked' })
				})
			).toBeNull();
		});
	});

	describe('admissions', () => {
		it('recognizes an active contact in the org the slug named', () => {
			const row = contact();
			expect(decideSiteViewer({ orgId: 'org1', userId: 'user1', contact: row })).toEqual({
				orgId: 'org1',
				userId: 'user1',
				contact: row
			});
		});

		it('hands back the same contact object it was given, so the caller never re-reads the row', () => {
			const row = contact();
			const decision = decideSiteViewer({ orgId: 'org1', userId: 'user1', contact: row });
			expect(decision?.contact).toBe(row);
		});

		it('takes the org and the person from the lookups, not from the contact', () => {
			const row = contact({ _id: 'contact9', orgId: 'org1' });
			const decision = decideSiteViewer({ orgId: 'org1', userId: 'user7', contact: row });
			expect(decision?.orgId).toBe('org1');
			expect(decision?.userId).toBe('user7');
		});
	});
});
