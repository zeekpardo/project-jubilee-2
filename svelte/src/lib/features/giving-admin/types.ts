import type { FunctionReturnType } from 'convex/server';
import type { api } from '$convex/_generated/api';

/**
 * The shape `stripe.queries.getConnectAccount` actually returns.
 *
 * Derived from the query rather than hand-written, so a field added or removed
 * on the server surfaces here as a type error rather than as an admin card
 * silently rendering `undefined`.
 */
export type ConnectAccount = NonNullable<
	FunctionReturnType<typeof api.stripe.queries.getConnectAccount>
>;
