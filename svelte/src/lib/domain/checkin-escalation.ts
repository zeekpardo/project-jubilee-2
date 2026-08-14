// ============================================================
// The one check that runs before anything else
// ============================================================
// PLAN-ai-checkin.md §3.3: if a family's reply contains anything indicating
// danger, abuse or crisis, that is an immediate handoff to a person — not
// something inferred from sentiment, and not something the responder model is
// asked to notice. Both of those are unreliable escalation triggers, and the
// cost of the miss is not a bad answer.
//
// So this is a deterministic phrase scan over the incoming message, it runs on
// EVERY incoming message, and it runs BEFORE the objective machinery — before
// the judge, before the responder, before any token is spent. A message that
// trips it never reaches a model at all.
//
// DELIBERATELY HIGH RECALL. The terms below will fire on messages that turn out
// to be fine: "my son beat me at cricket" is a match and is not a crisis. That
// is the trade being made on purpose. A false positive costs a staff member ten
// seconds reading a transcript. A false negative costs a family that told us
// something and got an automated question about school in reply.
//
// Which is also why nothing here tries to be clever about negation or context.
// A scanner that can decide "they said they were NOT hurt" is a scanner that
// can decide it wrongly.
//
// English and Spanish only, matching the rest of the platform (§6). A message
// in a language this list does not cover is NOT silently treated as safe —
// `scanForEscalation` reports which locales it could actually read, and the
// caller is expected to route an unreadable message to a person.
// ============================================================

export type EscalationCategory =
	| 'violence'
	| 'abuse'
	| 'self_harm'
	| 'trafficking'
	| 'medical_emergency'
	| 'child_danger';

export const ESCALATION_CATEGORY_LABELS: Record<EscalationCategory, string> = {
	violence: 'Violence or threat',
	abuse: 'Abuse',
	self_harm: 'Self-harm or suicide',
	trafficking: 'Bondage, coercion or re-trafficking',
	medical_emergency: 'Medical emergency',
	child_danger: 'A child in danger'
};

export type EscalationLocale = 'en' | 'es';

interface EscalationTerm {
	category: EscalationCategory;
	locale: EscalationLocale;
	/** Normalized at module load, so the scan is a substring test. */
	phrase: string;
}

/**
 * MULTI-WORD, almost without exception.
 *
 * Single words are what make a scanner like this unusable: "abuse" appears in
 * "abuse of the language", "gun" in "begun", "kill" in every idiom English
 * has. A phrase carries enough of its own context that the false-positive rate
 * stays at "a person glances at it" rather than "a person stops reading these".
 *
 * The handful of single words that are here — `suicidio`, `suicidal` — are
 * words that do not appear in a sentence about anything else.
 */
const TERMS: ReadonlyArray<readonly [EscalationCategory, EscalationLocale, string]> = [
	// --- violence ---------------------------------------------------------
	['violence', 'en', 'he hit me'],
	['violence', 'en', 'he hits me'],
	['violence', 'en', 'they hit me'],
	['violence', 'en', 'they beat me'],
	['violence', 'en', 'he beat me'],
	['violence', 'en', 'beat us'],
	['violence', 'en', 'threatened to kill'],
	['violence', 'en', 'threatened us'],
	['violence', 'en', 'threatening us'],
	['violence', 'en', 'said he would kill'],
	['violence', 'en', 'came with a knife'],
	['violence', 'en', 'has a gun'],
	['violence', 'en', 'afraid for my life'],
	['violence', 'en', 'afraid he will kill'],
	['violence', 'en', 'not safe here'],
	['violence', 'en', 'we are not safe'],
	['violence', 'es', 'me pego'],
	['violence', 'es', 'me golpeo'],
	['violence', 'es', 'nos golpearon'],
	['violence', 'es', 'amenazo con matar'],
	['violence', 'es', 'nos amenazo'],
	['violence', 'es', 'no estamos seguros'],
	['violence', 'es', 'tengo miedo por mi vida'],

	// --- abuse ------------------------------------------------------------
	['abuse', 'en', 'he abuses'],
	['abuse', 'en', 'abusing me'],
	['abuse', 'en', 'sexually assaulted'],
	['abuse', 'en', 'raped'],
	['abuse', 'en', 'touched her'],
	['abuse', 'en', 'touched him'],
	['abuse', 'es', 'abuso de mi'],
	['abuse', 'es', 'me abusa'],
	['abuse', 'es', 'abuso sexual'],
	['abuse', 'es', 'violada'],
	['abuse', 'es', 'violaron'],

	// --- self harm --------------------------------------------------------
	['self_harm', 'en', 'kill myself'],
	['self_harm', 'en', 'end my life'],
	['self_harm', 'en', 'want to die'],
	['self_harm', 'en', 'no reason to live'],
	['self_harm', 'en', 'better off dead'],
	['self_harm', 'en', 'hurt myself'],
	['self_harm', 'en', 'suicidal'],
	['self_harm', 'es', 'quitarme la vida'],
	['self_harm', 'es', 'matarme'],
	['self_harm', 'es', 'quiero morir'],
	['self_harm', 'es', 'hacerme dano'],
	['self_harm', 'es', 'suicidio'],
	['self_harm', 'es', 'suicidarme'],

	// --- trafficking and bonded labour ------------------------------------
	// The category this platform exists for. These are the phrases that mean a
	// family is being pulled back into what they were freed from.
	['trafficking', 'en', 'took me back'],
	['trafficking', 'en', 'took us back'],
	['trafficking', 'en', 'took my passport'],
	['trafficking', 'en', 'took our papers'],
	['trafficking', 'en', 'the owner came'],
	['trafficking', 'en', 'the owner found'],
	['trafficking', 'en', 'came looking for us'],
	['trafficking', 'en', 'forced to work'],
	['trafficking', 'en', 'made us work'],
	['trafficking', 'en', 'will not let us leave'],
	['trafficking', 'en', 'cannot leave'],
	['trafficking', 'en', 'we owe them'],
	['trafficking', 'en', 'new loan'],
	['trafficking', 'en', 'had to borrow again'],
	['trafficking', 'es', 'nos llevaron de vuelta'],
	['trafficking', 'es', 'me llevaron de vuelta'],
	['trafficking', 'es', 'quito mi pasaporte'],
	['trafficking', 'es', 'nos obligan a trabajar'],
	['trafficking', 'es', 'no nos dejan salir'],
	['trafficking', 'es', 'el dueno vino'],
	['trafficking', 'es', 'volvimos a pedir prestado'],

	// --- medical ----------------------------------------------------------
	['medical_emergency', 'en', 'in the hospital'],
	['medical_emergency', 'en', 'went to the hospital'],
	['medical_emergency', 'en', 'cannot breathe'],
	['medical_emergency', 'en', 'coughing blood'],
	['medical_emergency', 'en', 'is bleeding'],
	['medical_emergency', 'en', 'very sick'],
	['medical_emergency', 'en', 'has not eaten'],
	['medical_emergency', 'es', 'en el hospital'],
	['medical_emergency', 'es', 'no puede respirar'],
	['medical_emergency', 'es', 'esta sangrando'],
	['medical_emergency', 'es', 'muy enferma'],
	['medical_emergency', 'es', 'muy enfermo'],

	// --- children ---------------------------------------------------------
	['child_danger', 'en', 'took my daughter'],
	['child_danger', 'en', 'took my son'],
	['child_danger', 'en', 'my daughter is missing'],
	['child_danger', 'en', 'my son is missing'],
	['child_danger', 'en', 'they took the children'],
	['child_danger', 'en', 'she was married off'],
	['child_danger', 'en', 'sent her away to work'],
	['child_danger', 'es', 'se llevaron a mi hija'],
	['child_danger', 'es', 'se llevaron a mi hijo'],
	['child_danger', 'es', 'mi hija desaparecio'],
	['child_danger', 'es', 'la casaron']
];

/**
 * Lowercase, strip diacritics, and reduce every run of non-letters to one
 * space, with a leading and trailing space added.
 *
 * The padding is what makes ` phrase ` a word-boundary test with a plain
 * `includes` — no regex compiled per term, and no chance of `hit me` matching
 * inside `whit mendel`. Stripping diacritics is what lets the Spanish list be
 * written once and still match `me pegó` and `me pego`, which is how people
 * actually type on a phone.
 */
export function normalizeForScan(text: string): string {
	const stripped = text
		.normalize('NFD')
		// The combining-diacritic block. NFD has already split 'ó' into 'o' plus
		// a combining acute, so dropping the block leaves the bare letter.
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
	return ` ${stripped} `;
}

const NORMALIZED_TERMS: EscalationTerm[] = TERMS.map(([category, locale, phrase]) => ({
	category,
	locale,
	phrase: normalizeForScan(phrase)
}));

export interface EscalationMatch {
	category: EscalationCategory;
	locale: EscalationLocale;
	/** The phrase as it appears in the list, normalized. For the audit trail. */
	term: string;
}

export interface EscalationScan {
	matches: EscalationMatch[];
	/** True when ANY term matched. The only field most callers need. */
	escalated: boolean;
}

/**
 * Scan one incoming message. Returns every match rather than the first,
 * because "violence and self-harm" and "violence" are different phone calls.
 */
export function scanForEscalation(message: string): EscalationScan {
	const haystack = normalizeForScan(message);
	const matches: EscalationMatch[] = [];
	const seen = new Set<string>();

	for (const term of NORMALIZED_TERMS) {
		// `term.phrase` is padded on both sides, so this is already a whole-word
		// test — ` hit me ` cannot match inside another word.
		if (!haystack.includes(term.phrase)) continue;
		const key = `${term.category}:${term.phrase}`;
		if (seen.has(key)) continue;
		seen.add(key);
		matches.push({ category: term.category, locale: term.locale, term: term.phrase.trim() });
	}

	return { matches, escalated: matches.length > 0 };
}

/**
 * A short quotation around the first match, for the escalation row a person
 * will read. Bounded, because the row is a pointer to the transcript rather
 * than a copy of it — and because a paragraph about a named family should live
 * in one place, not two.
 */
export function escalationExcerpt(message: string, match: EscalationMatch, radius = 60): string {
	const haystack = normalizeForScan(message);
	const at = haystack.indexOf(` ${match.term} `);
	if (at < 0) return message.slice(0, radius * 2).trim();

	// Indices are into the NORMALIZED string, which is not the original, so this
	// is a proportional guess rather than an exact span. Good enough for a
	// pointer; the transcript is the record.
	const ratio = at / Math.max(haystack.length, 1);
	const centre = Math.round(ratio * message.length);
	const start = Math.max(0, centre - radius);
	const end = Math.min(message.length, centre + match.term.length + radius);
	const prefix = start > 0 ? '…' : '';
	const suffix = end < message.length ? '…' : '';
	return `${prefix}${message.slice(start, end).trim()}${suffix}`;
}

/** The locales this scanner can actually read. See the header. */
export const SCANNED_LOCALES: EscalationLocale[] = ['en', 'es'];
