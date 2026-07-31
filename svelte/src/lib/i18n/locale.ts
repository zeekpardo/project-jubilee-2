import { baseLocale, getLocale, isLocale, locales, setLocale } from './paraglide/runtime.js';

export type Locale = (typeof locales)[number];

export type LocaleOption = { value: Locale; label: string };

const LOCALE_LABELS: Record<string, string> = {
	en: 'English'
};

export const LOCALES: readonly LocaleOption[] = locales.map((locale) => ({
	value: locale,
	label: LOCALE_LABELS[locale] ?? locale
}));

export const DEFAULT_LOCALE: Locale = baseLocale;

export function resolveLocale(value: unknown): Locale {
	return isLocale(value) ? value : baseLocale;
}

/**
 * Persist the locale (Paraglide writes the `PARAGLIDE_LOCALE` cookie) and reload
 * so the server re-renders every message in the new language.
 */
export function switchLocale(locale: Locale): void {
	void setLocale(locale);
}

export { baseLocale, getLocale, isLocale, locales, setLocale };
