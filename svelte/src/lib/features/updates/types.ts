import type { FunctionReturnType } from 'convex/server';
import type { api } from '$convex/_generated/api';

/**
 * One update as the authoring screens read it: the row plus its photographs
 * resolved to URLs.
 *
 * Derived from the campaign query rather than re-declared, so a column added or
 * renamed server-side surfaces as a type error here instead of rendering blank.
 * Deriving from ONE of the two list queries is deliberate and safe: both return
 * `AdminUpdate[]`, and the two parents differ only in whether `projectId` is
 * set, which is the whole reason this feature is one set of components.
 */
export type AdminUpdate = FunctionReturnType<
	typeof api.updates.queries.listUpdatesForCampaign
>[number];
