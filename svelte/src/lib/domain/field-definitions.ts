// ============================================================
// Field definitions — the per-campaign "form" (Phase 3)
// ============================================================
// Descriptive fields are data, not hardcoded columns: an org owns a set of
// field definitions, and every record carries an `attributes` bag keyed by
// field `key`. Definitions are declared org-wide or per-campaign, and a
// campaign inherits the org-wide ones (see resolveFieldDefinitions). Pure
// helpers here — no db/IO — so they are trivially testable on server and
// client.
// ============================================================

export type FieldType = 'text' | 'longtext' | 'number' | 'money' | 'date' | 'select' | 'boolean';

export const FIELD_TYPES: FieldType[] = [
	'text',
	'longtext',
	'number',
	'money',
	'date',
	'select',
	'boolean'
];

/** Which record type a definition applies to. */
export type FieldEntity = 'contact' | 'project' | 'campaign';

/**
 * Where a definition comes from. 'org' fields apply to every campaign;
 * 'campaign' fields apply only to their own campaign.
 */
export type FieldScope = 'org' | 'campaign';

/** One field in a form. `options` is the choice list for 'select'. */
export interface FieldDefinition {
	id: string;
	entity: FieldEntity;
	scope: FieldScope;
	/** Null for org-scope fields; the owning campaign for campaign-scope ones. */
	campaignId: string | null;
	/** The field's category, or null (uncategorized). */
	categoryId: string | null;
	key: string;
	label: string;
	type: FieldType;
	options: string[] | null;
	order: number;
	isPublic: boolean;
	isRequired: boolean;
}

/** All custom field values for one project, keyed by field `key`. */
export type Attributes = Record<string, unknown>;

/** The value stored for a definition's key (null when unset). */
export function attributeValue(attributes: Attributes, def: FieldDefinition): unknown {
	const value = attributes[def.key];
	return value === undefined ? null : value;
}

/**
 * Coerce a raw string (from an input) into the typed value stored in
 * `attributes` for a definition. Empty string → null. Throws on invalid
 * number/money/date/boolean/select so callers can surface a field error.
 */
export function coerceFieldValue(def: FieldDefinition, raw: unknown): unknown {
	// `unknown`, not `string`, because the callers are form bindings: Svelte
	// hands back a real number from `<input type="number">`, and a `string`
	// signature merely hid that until `.trim()` threw at runtime. Normalising
	// here keeps every caller from having to remember it.
	if (raw === null || raw === undefined) return null;
	const trimmed = String(raw).trim();
	if (trimmed === '') return null;

	switch (def.type) {
		case 'number':
		case 'money': {
			const n = Number(trimmed);
			if (!Number.isFinite(n)) throw new Error(`${def.label} must be a number`);
			// money is stored as integer cents.
			return def.type === 'money' ? Math.round(n * 100) : n;
		}
		case 'boolean':
			return trimmed === 'true' || trimmed === '1' || trimmed.toLowerCase() === 'yes';
		case 'date':
			if (Number.isNaN(Date.parse(trimmed))) throw new Error(`${def.label} must be a valid date`);
			return trimmed;
		case 'select':
			if (def.options && !def.options.includes(trimmed)) {
				throw new Error(`${def.label} must be one of: ${def.options.join(', ')}`);
			}
			return trimmed;
		default:
			return trimmed;
	}
}

/** Display string for a stored attribute value (empty string when unset). */
export function formatFieldValue(def: FieldDefinition, value: unknown): string {
	if (value === null || value === undefined || value === '') return '';
	switch (def.type) {
		case 'money': {
			const cents = typeof value === 'number' ? value : Number(value);
			if (!Number.isFinite(cents)) return '';
			return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
		}
		case 'boolean':
			return value ? 'Yes' : 'No';
		case 'number':
			return String(value);
		default:
			return String(value);
	}
}

/**
 * Validate a full attributes bag against a campaign's definitions: every
 * required field must be present/non-empty. Returns the list of missing field
 * labels (empty when valid). Unknown keys are ignored (a definition may have
 * been removed after values were set).
 */
export function missingRequiredFields(defs: FieldDefinition[], attributes: Attributes): string[] {
	const missing: string[] = [];
	for (const def of defs) {
		if (!def.isRequired) continue;
		const value = attributes[def.key];
		if (value === null || value === undefined || value === '') missing.push(def.label);
	}
	return missing;
}

/**
 * The definitions that apply to a record: every org-scope field for the
 * entity, plus the campaign's own. A campaign field with the same `key` as an
 * org field REPLACES it — values are stored under one key, so an override is
 * the only coherent reading. Result is sorted by order, then key for stability.
 */
export function resolveFieldDefinitions(
	defs: FieldDefinition[],
	entity: FieldEntity,
	campaignId: string | null
): FieldDefinition[] {
	const byKey = new Map<string, FieldDefinition>();

	for (const def of defs) {
		if (def.entity !== entity) continue;
		// An org-scope row carrying a campaignId is malformed. Skip it rather
		// than treating it as org-wide, which would apply one campaign's field
		// to every campaign.
		if (def.scope === 'org' && def.campaignId === null) byKey.set(def.key, def);
	}
	for (const def of defs) {
		if (def.entity !== entity) continue;
		if (def.scope === 'campaign' && campaignId !== null && def.campaignId === campaignId) {
			byKey.set(def.key, def);
		}
	}

	return [...byKey.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

/** The subset of definitions safe to expose publicly. */
export function publicFieldDefinitions(defs: FieldDefinition[]): FieldDefinition[] {
	return defs.filter((def) => def.isPublic);
}

// ------------------------------------------------------------------
// Protected keys — a denylist independent of the `isPublic` checkbox
// ------------------------------------------------------------------
// `isPublic` is an admin-settable flag on a definition, so it can be ticked
// by mistake, or on a row written before this list existed. These keys can
// out someone still escaping forced labour, so they are withheld regardless
// of that flag: `isProtectedFieldKey` is enforced both where a definition is
// written (customFields/mutations.ts, so the flag can never even be set)
// and again where attributes are read for the public site
// (publicAttributes below), so no past or future write path can leak one.

/**
 * Exact keys that are always withheld, whatever the field is labelled, in
 * every organization. These are SHARED because what they leak — where someone
 * was held, how to reach them, what a caseworker wrote about them — is
 * dangerous for anyone this app serves, not for one org in particular.
 *
 * An org's own keys go in `orgSettings.protectedFieldKeys` and are passed in
 * as `extraKeys` below. `managed_missions_link` used to live here and does
 * not any more: it named one organization's integration, and every other
 * tenant inherited it as a rule. It moved to that org's own settings.
 */
export const PROTECTED_FIELD_KEYS = ['site_ref', 'whatsapp_phone', 'note'];

// Beyond the exact keys above, anything shaped like a site reference or a way
// to reach/find someone is withheld too, so a differently-named field can't
// route around the list (e.g. `factory_ref`, `contact_phone`, `home_address`).
const PROTECTED_KEY_PATTERNS = [/_ref$/, /phone/, /address/, /location/];

function normalizeFieldKey(key: string): string {
	return key.trim().toLowerCase();
}

/**
 * `extraKeys` is an org's own additions, from its public policy. It can only
 * ever ADD: an org may decide more is dangerous in its context, never that
 * less is, because the shared list above protects people rather than tenants.
 */
export function isProtectedFieldKey(key: string, extraKeys: string[] = []): boolean {
	const normalized = normalizeFieldKey(key);
	if (PROTECTED_FIELD_KEYS.includes(normalized)) return true;
	if (extraKeys.some((extra) => normalizeFieldKey(extra) === normalized)) return true;
	return PROTECTED_KEY_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Strip an attributes bag down to only the values whose definition is marked
 * public. The privacy wall uses this — an unknown key is dropped, so removing
 * a definition can never leak a stale value. A protected key is dropped even
 * if its definition is (incorrectly) marked public — see isProtectedFieldKey.
 */
export function publicAttributes(
	defs: FieldDefinition[],
	attributes: Attributes,
	extraProtectedKeys: string[] = []
): Attributes {
	const out: Attributes = {};
	for (const attribute of publicAttributeList(defs, attributes, extraProtectedKeys)) {
		out[attribute.key] = attribute.value;
	}
	return out;
}

/** One publishable attribute, carrying what a reader needs to render it. */
export interface PublicAttribute {
	key: string;
	label: string;
	type: FieldType;
	value: unknown;
}

/**
 * The same exposure decision as publicAttributes, but keeping each value's
 * definition alongside it. A bare key/value bag forces every reader to invent
 * a label from the key ("years_enslaved" → "Years Enslaved"), which throws
 * away the wording an admin chose, and to guess at formatting, which renders
 * a money field as raw cents. Order follows the definitions, so a campaign's
 * field order carries through to the page.
 *
 * This is the single gate: publicAttributes delegates here, so the protected
 * key check cannot be enforced in one path and forgotten in the other.
 */
export function publicAttributeList(
	defs: FieldDefinition[],
	attributes: Attributes,
	extraProtectedKeys: string[] = []
): PublicAttribute[] {
	const out: PublicAttribute[] = [];
	for (const def of publicFieldDefinitions(defs)) {
		if (isProtectedFieldKey(def.key, extraProtectedKeys)) continue;
		const value = attributes[def.key];
		if (value === undefined || value === null || value === '') continue;
		out.push({ key: def.key, label: def.label, type: def.type, value });
	}
	return out;
}
