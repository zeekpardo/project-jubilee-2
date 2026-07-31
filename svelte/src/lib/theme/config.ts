export type Theme = 'jubilee' | 'sandstone';
export type Mode = 'light' | 'dark' | 'system';

export type ThemeOption = { value: Theme; label: string };
export type ModeOption = { value: Mode; label: string };

export const THEMES: readonly ThemeOption[] = [
	{ value: 'jubilee', label: 'Jubilee' },
	{ value: 'sandstone', label: 'Sandstone' }
];

export const MODES: readonly Mode[] = ['light', 'dark', 'system'];

export const DEFAULT_THEME: Theme = 'jubilee';
export const DEFAULT_MODE: Mode = 'system';

export const THEME_COOKIE = 'jubilee-theme';
export const MODE_COOKIE = 'jubilee-mode';
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

export const DARK_CLASS = 'dark';

export function isTheme(value: unknown): value is Theme {
	return THEMES.some((theme) => theme.value === value);
}

export function isMode(value: unknown): value is Mode {
	return MODES.includes(value as Mode);
}

export function resolveTheme(value: unknown): Theme {
	return isTheme(value) ? value : DEFAULT_THEME;
}

export function resolveMode(value: unknown): Mode {
	return isMode(value) ? value : DEFAULT_MODE;
}

/**
 * The class applied to <html> for a given mode. `system` resolves to an empty
 * string because the server cannot know the OS preference — mode-watcher's
 * head script fills it in before first paint.
 */
export function modeClass(mode: Mode): string {
	return mode === 'dark' ? DARK_CLASS : '';
}
