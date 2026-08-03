import { describe, expect, it } from 'vitest';

import { safeRedirectTo } from './safe-redirect';

const HOME = '/jubilee';

describe('safeRedirectTo', () => {
	describe('admits a same-site path', () => {
		it('keeps a plain relative path', () => {
			expect(safeRedirectTo('/jubilee/families/1204', HOME)).toBe('/jubilee/families/1204');
		});

		it('keeps a query string and fragment, which carry the state someone left behind', () => {
			expect(safeRedirectTo('/jubilee/families?give=1#form', HOME)).toBe(
				'/jubilee/families?give=1#form'
			);
		});

		it('keeps the root', () => {
			expect(safeRedirectTo('/', HOME)).toBe('/');
		});
	});

	describe('falls back when there is nothing usable', () => {
		it('falls back on null', () => {
			expect(safeRedirectTo(null, HOME)).toBe(HOME);
		});

		it('falls back on undefined', () => {
			expect(safeRedirectTo(undefined, HOME)).toBe(HOME);
		});

		it('falls back on an empty string', () => {
			expect(safeRedirectTo('', HOME)).toBe(HOME);
		});
	});

	describe('refuses another origin', () => {
		it('refuses an absolute https URL', () => {
			expect(safeRedirectTo('https://evil.example/pay', HOME)).toBe(HOME);
		});

		it('refuses a protocol-relative URL', () => {
			expect(safeRedirectTo('//evil.example/pay', HOME)).toBe(HOME);
		});

		it('refuses the backslash form, which browsers normalise to //', () => {
			expect(safeRedirectTo('/\\evil.example', HOME)).toBe(HOME);
		});

		it('refuses a host that merely looks like ours', () => {
			expect(safeRedirectTo('https://jubilee.example.evil.com/give', HOME)).toBe(HOME);
		});

		it('refuses a scheme that is not http at all', () => {
			expect(safeRedirectTo('javascript:alert(1)', HOME)).toBe(HOME);
		});

		it('refuses a bare relative path, which would resolve against the current directory', () => {
			expect(safeRedirectTo('families/1204', HOME)).toBe(HOME);
		});
	});

	// The strip runs before the protocol-relative check. Run it the other way
	// round and each of these passes the guard, then becomes a foreign origin
	// once the browser removes the whitespace for us.
	describe('refuses whitespace-smuggled origins', () => {
		it('refuses a tab between the slashes', () => {
			expect(safeRedirectTo('/\t/evil.example', HOME)).toBe(HOME);
		});

		it('refuses a newline between the slashes', () => {
			expect(safeRedirectTo('/\n/evil.example', HOME)).toBe(HOME);
		});

		it('refuses a carriage return between the slashes', () => {
			expect(safeRedirectTo('/\r/evil.example', HOME)).toBe(HOME);
		});

		it('refuses whitespace smuggled into the backslash form', () => {
			expect(safeRedirectTo('/\t\\evil.example', HOME)).toBe(HOME);
		});

		it('strips harmless whitespace out of an otherwise good path rather than refusing it', () => {
			expect(safeRedirectTo('/jubilee/fam\tilies', HOME)).toBe('/jubilee/families');
		});
	});
});
