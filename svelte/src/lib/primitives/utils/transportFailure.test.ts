import { describe, expect, it } from 'vitest';
import { ConvexError } from 'convex/values';
import { isTransportFailure } from './transportFailure';

/** The exact shape undici throws when the host is unreachable. */
function undiciFetchFailed(code: string): TypeError {
	return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
}

describe('isTransportFailure', () => {
	describe('degrades', () => {
		it('matches the undici TypeError seen when Convex is unreachable', () => {
			expect(isTransportFailure(undiciFetchFailed('ECONNREFUSED'))).toBe(true);
		});

		it('matches a bare fetch TypeError with no cause attached', () => {
			expect(isTransportFailure(new TypeError('fetch failed'))).toBe(true);
		});

		it('matches the browser wordings of the same failure', () => {
			expect(isTransportFailure(new TypeError('Failed to fetch'))).toBe(true);
			expect(isTransportFailure(new TypeError('Load failed'))).toBe(true);
		});

		it.each([
			'ECONNRESET',
			'ENOTFOUND',
			'EAI_AGAIN',
			'ETIMEDOUT',
			'EHOSTUNREACH',
			'UND_ERR_CONNECT_TIMEOUT',
			'UND_ERR_HEADERS_TIMEOUT'
		])('matches errno %s anywhere in the cause chain', (code) => {
			expect(isTransportFailure(undiciFetchFailed(code))).toBe(true);
		});

		it('matches an aborted or timed-out request', () => {
			expect(isTransportFailure(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(
				true
			);
			expect(
				isTransportFailure(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
			).toBe(true);
		});

		it('finds the errno through a nested cause chain', () => {
			const inner = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
			const middle = new Error('request failed', { cause: inner });
			expect(isTransportFailure(new TypeError('fetch failed', { cause: middle }))).toBe(true);
		});
	});

	describe('propagates', () => {
		it('does not match a ConvexError thrown by a query', () => {
			expect(isTransportFailure(new ConvexError('Not authenticated'))).toBe(false);
		});

		it('does not match the plain Error the client builds from a non-2xx body', () => {
			// `ConvexHttpClient` throws `new Error(await response.text())`, so a 401
			// arrives as an ordinary Error carrying the response body.
			expect(isTransportFailure(new Error('{"code":"Unauthenticated","message":"..."}'))).toBe(
				false
			);
		});

		it('does not match a programming error, including a non-fetch TypeError', () => {
			expect(isTransportFailure(new TypeError('x.map is not a function'))).toBe(false);
			expect(isTransportFailure(new ReferenceError('client is not defined'))).toBe(false);
		});

		it('does not match a body that merely mentions a network failure', () => {
			// Message matching is gated on TypeError precisely so server-authored
			// text can never impersonate a transport failure.
			expect(isTransportFailure(new Error('fetch failed'))).toBe(false);
			expect(isTransportFailure(new ConvexError('ECONNREFUSED'))).toBe(false);
		});

		it('does not match non-error values', () => {
			expect(isTransportFailure(undefined)).toBe(false);
			expect(isTransportFailure(null)).toBe(false);
			expect(isTransportFailure('fetch failed')).toBe(false);
		});

		it('terminates on a self-referencing cause chain', () => {
			const loop: { cause?: unknown } = {};
			loop.cause = loop;
			expect(isTransportFailure(loop)).toBe(false);
		});
	});
});
