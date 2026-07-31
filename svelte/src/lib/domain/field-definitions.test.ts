import { describe, expect, it } from 'vitest';

import {
	coerceFieldValue,
	formatFieldValue,
	missingRequiredFields,
	publicAttributes,
	resolveFieldDefinitions,
	type FieldDefinition
} from './field-definitions';

const def = (over: Partial<FieldDefinition>): FieldDefinition => ({
	id: 'f1',
	entity: 'project',
	scope: 'org',
	campaignId: null,
	categoryId: null,
	key: 'k',
	label: 'Field',
	type: 'text',
	options: null,
	order: 1,
	isPublic: false,
	isRequired: false,
	...over
});

describe('coerceFieldValue', () => {
	it('empty string coerces to null for any type', () => {
		expect(coerceFieldValue(def({ type: 'number' }), '  ')).toBeNull();
		expect(coerceFieldValue(def({ type: 'text' }), '')).toBeNull();
	});

	it('number parses and rejects non-numbers', () => {
		expect(coerceFieldValue(def({ type: 'number' }), '12')).toBe(12);
		expect(() => coerceFieldValue(def({ type: 'number' }), 'abc')).toThrow();
	});

	it('money stores integer cents', () => {
		expect(coerceFieldValue(def({ type: 'money' }), '10.50')).toBe(1050);
	});

	it('date validates parseability', () => {
		expect(coerceFieldValue(def({ type: 'date' }), '2026-01-01')).toBe('2026-01-01');
		expect(() => coerceFieldValue(def({ type: 'date' }), 'not-a-date')).toThrow();
	});

	it('select enforces the options list', () => {
		const d = def({ type: 'select', options: ['a', 'b'] });
		expect(coerceFieldValue(d, 'a')).toBe('a');
		expect(() => coerceFieldValue(d, 'c')).toThrow();
	});

	it('boolean reads truthy tokens', () => {
		expect(coerceFieldValue(def({ type: 'boolean' }), 'yes')).toBe(true);
		expect(coerceFieldValue(def({ type: 'boolean' }), 'no')).toBe(false);
	});
});

describe('formatFieldValue', () => {
	it('formats money cents as currency', () => {
		expect(formatFieldValue(def({ type: 'money' }), 1050)).toBe('$10.50');
	});
	it('formats booleans and empties', () => {
		expect(formatFieldValue(def({ type: 'boolean' }), true)).toBe('Yes');
		expect(formatFieldValue(def({ type: 'text' }), null)).toBe('');
	});
});

describe('missingRequiredFields', () => {
	it('reports only unset required fields by label', () => {
		const defs = [
			def({ key: 'a', label: 'A', isRequired: true }),
			def({ key: 'b', label: 'B', isRequired: true }),
			def({ key: 'c', label: 'C', isRequired: false })
		];
		expect(missingRequiredFields(defs, { a: 'x' })).toEqual(['B']);
		expect(missingRequiredFields(defs, { a: 'x', b: 'y' })).toEqual([]);
	});
});

describe('resolveFieldDefinitions', () => {
	const orgField = def({ id: 'o1', scope: 'org', campaignId: null, key: 'religion', order: 2 });
	const otherEntity = def({
		id: 'x1',
		scope: 'org',
		campaignId: null,
		key: 'donor_tier',
		entity: 'contact'
	});
	const campField = def({
		id: 'c1f',
		scope: 'campaign',
		campaignId: 'camp1',
		key: 'kiln_site',
		order: 1
	});
	const otherCampField = def({
		id: 'c2f',
		scope: 'campaign',
		campaignId: 'camp2',
		key: 'boat_name'
	});

	it('a campaign inherits org-wide fields', () => {
		const got = resolveFieldDefinitions([orgField, campField], 'project', 'camp1');
		expect(got.map((d) => d.key)).toEqual(['kiln_site', 'religion']);
	});

	it('excludes other campaigns fields', () => {
		const got = resolveFieldDefinitions([orgField, campField, otherCampField], 'project', 'camp1');
		expect(got.map((d) => d.key)).not.toContain('boat_name');
	});

	it('excludes other entities fields', () => {
		const got = resolveFieldDefinitions([orgField, otherEntity], 'project', 'camp1');
		expect(got.map((d) => d.key)).toEqual(['religion']);
	});

	it('org fields alone resolve when there is no campaign', () => {
		const got = resolveFieldDefinitions([orgField, campField], 'project', null);
		expect(got.map((d) => d.key)).toEqual(['religion']);
	});

	it('a campaign field overrides an org field with the same key', () => {
		const override = def({
			id: 'ov',
			scope: 'campaign',
			campaignId: 'camp1',
			key: 'religion',
			label: 'Faith'
		});
		const got = resolveFieldDefinitions([orgField, override], 'project', 'camp1');
		expect(got).toHaveLength(1);
		expect(got[0].label).toBe('Faith');
	});
});

describe('publicAttributes', () => {
	const publicDef = def({ key: 'story_note', isPublic: true });
	const privateDef = def({ key: 'site_ref', isPublic: false });

	it('keeps only values whose definition is public', () => {
		const got = publicAttributes([publicDef, privateDef], {
			story_note: 'freed in June',
			site_ref: 'KILN-42'
		});
		expect(got).toEqual({ story_note: 'freed in June' });
	});

	it('drops keys with no definition, so a removed field cannot leak', () => {
		const got = publicAttributes([publicDef], { story_note: 'ok', orphaned: 'SECRET' });
		expect(got).toEqual({ story_note: 'ok' });
	});

	it('omits empty and unset values', () => {
		const got = publicAttributes([publicDef], { story_note: '' });
		expect(got).toEqual({});
	});
});
