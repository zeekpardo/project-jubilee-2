/**
 * Tells a "the request never reached Convex" failure apart from "Convex replied
 * and said no".
 *
 * `ConvexHttpClient` only ever produces two shapes of error:
 *
 * - `fetch()` itself rejected — DNS, refused connection, reset socket, timeout.
 *   Nothing was evaluated, so nothing about the caller is known to be wrong.
 * - A reply came back and the client turned it into an `Error` (non-2xx body
 *   text) or a `ConvexError` (the function threw). An expired token, a revoked
 *   session and a genuine bug all land here.
 *
 * Only the first class is safe to degrade past: it says nothing about the user,
 * so retrying client-side will fix it. The second class carries the server's
 * actual verdict and must keep propagating — swallowing it would leave someone
 * staring at a half-rendered shell that never recovers.
 */

/** Node/undici error codes that mean the request never got a reply. */
const TRANSPORT_CODES = new Set([
	'ECONNABORTED',
	'ECONNREFUSED',
	'ECONNRESET',
	'EAI_AGAIN',
	'EHOSTUNREACH',
	'ENETUNREACH',
	'ENOTFOUND',
	'EPIPE',
	'EPROTO',
	'ETIMEDOUT',
	'UND_ERR_BODY_TIMEOUT',
	'UND_ERR_CLOSED',
	'UND_ERR_CONNECT_TIMEOUT',
	'UND_ERR_DESTROYED',
	'UND_ERR_HEADERS_TIMEOUT',
	'UND_ERR_SOCKET'
]);

/** An aborted or timed-out request never got a reply either. */
const ABORT_NAMES = new Set(['AbortError', 'TimeoutError']);

/**
 * What `fetch` rejects with when the transport gives out, across runtimes:
 * undici/Node ("fetch failed"), Chrome/Firefox ("Failed to fetch"), Safari
 * ("Load failed"). Matched only on a `TypeError`, which is the type `fetch`
 * uses for transport failure — a `ConvexError` or the client's own
 * `new Error(body)` can never be mistaken for one.
 */
const FETCH_FAILURE_MESSAGES = [/^fetch failed$/i, /^failed to fetch$/i, /^load failed$/i];

/** Guards against a self-referencing `cause` chain. */
const MAX_CAUSE_DEPTH = 8;

/**
 * True only for a network/transport failure, walking the `cause` chain because
 * undici hangs the real errno off `TypeError('fetch failed').cause`.
 */
export function isTransportFailure(error: unknown, depth = 0): boolean {
	if (depth > MAX_CAUSE_DEPTH || typeof error !== 'object' || error === null) return false;

	const candidate = error as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };

	if (typeof candidate.code === 'string' && TRANSPORT_CODES.has(candidate.code)) return true;
	if (typeof candidate.name === 'string' && ABORT_NAMES.has(candidate.name)) return true;
	if (
		error instanceof TypeError &&
		typeof candidate.message === 'string' &&
		FETCH_FAILURE_MESSAGES.some((pattern) => pattern.test(candidate.message as string))
	) {
		return true;
	}

	return isTransportFailure(candidate.cause, depth + 1);
}
