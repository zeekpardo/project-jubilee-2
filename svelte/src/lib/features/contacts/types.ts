import type { FunctionReturnType } from 'convex/server';
import type { api } from '$convex/_generated/api';

export type ContactRow = FunctionReturnType<typeof api.contacts.queries.listContacts>[number];
export type HouseholdRow = FunctionReturnType<typeof api.households.queries.listHouseholds>[number];
