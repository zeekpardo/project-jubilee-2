import type { FunctionReturnType } from 'convex/server';
import type { api } from '$convex/_generated/api';
import type { Doc } from '$convex/_generated/dataModel';

/**
 * The stored contact, not whatever one particular query happens to return.
 *
 * This used to be derived from `listContacts`, which coupled every consumer to
 * that query's shape — `ContactFormDialog` derives three of its union types
 * from this and reads some thirty-odd fields, while never calling the query at
 * all. Any future narrowing of `listContacts` to a projection would have
 * broken a form that has nothing to do with it.
 */
export type ContactRow = Doc<'contacts'>;
export type HouseholdRow = FunctionReturnType<typeof api.households.queries.listHouseholds>[number];
