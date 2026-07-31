import { resetMode, setMode as setWatcherMode, setTheme as setWatcherTheme } from 'mode-watcher';
import {
	DEFAULT_MODE,
	DEFAULT_THEME,
	MODE_COOKIE,
	THEME_COOKIE,
	THEME_COOKIE_MAX_AGE,
	type Mode,
	type Theme
} from './config';

function writeCookie(name: string, value: string): void {
	if (typeof document === 'undefined') return;
	document.cookie = `${name}=${value}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
}

class ThemeState {
	#theme = $state<Theme>(DEFAULT_THEME);
	#mode = $state<Mode>(DEFAULT_MODE);

	get theme(): Theme {
		return this.#theme;
	}

	get mode(): Mode {
		return this.#mode;
	}

	/** Seed the store from the server-resolved cookie values so SSR and hydration agree. */
	init(theme: Theme, mode: Mode): void {
		this.#theme = theme;
		this.#mode = mode;
	}

	setTheme(theme: Theme): void {
		this.#theme = theme;
		writeCookie(THEME_COOKIE, theme);
		setWatcherTheme(theme);
	}

	setMode(mode: Mode): void {
		this.#mode = mode;
		writeCookie(MODE_COOKIE, mode);
		if (mode === 'system') {
			resetMode();
		} else {
			setWatcherMode(mode);
		}
	}
}

export const themeState = new ThemeState();

export const setTheme = (theme: Theme): void => themeState.setTheme(theme);
export const setMode = (mode: Mode): void => themeState.setMode(mode);
