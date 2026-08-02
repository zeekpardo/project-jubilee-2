// ============================================================
// The shapes the task UI renders, and the picker's own encoding
// ============================================================
// The row types are derived from the queries rather than re-declared, so a
// column added or renamed server-side surfaces as a type error here instead of
// silently rendering blank. `types.ts` cannot hold these — it is the pure
// module's contract and must not drag Convex's generated api behind it.
// ============================================================

import type { FunctionReturnType } from 'convex/server';
import type { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';
import type { TaskAssignee } from './types';

/** One hydrated row: the task document plus the names the table prints. */
export type TaskRow = FunctionReturnType<typeof api.tasks.queries.listTasks>['tasks'][number];

/** A task whose stat is currently published. An empty list means nothing to warn about. */
export type TaskImpactWarning = FunctionReturnType<
	typeof api.tasks.queries.listTaskImpactWarnings
>[number];

/** Org members and contacts, as one choice. */
export type AssignableMembers = FunctionReturnType<typeof api.tasks.queries.listAssignableMembers>;

// ------------------------------------------------------------------
// The assignee picker's option values
// ------------------------------------------------------------------
// Prefixed for the same reason the URL filter is: a user id and a contact id
// are both opaque strings, and nothing in an id says which table it came from.
// This is the PICKER's encoding and is deliberately NOT the URL's — `filters.ts`
// owns that one, a saved view is stored against it, and the two must be free to
// diverge without one silently reinterpreting the other's strings.

export const ASSIGNEE_UNASSIGNED = 'unassigned';

/**
 * What a WRITE accepts. Distinct from `TaskAssignee` in the pure module because
 * a picked contact id is branded — it came from a query, not from a URL, so the
 * mutation's `v.id('contacts')` can be satisfied without a cast at each call.
 */
export type TaskAssigneeWrite =
	| { kind: 'user'; userId: string }
	| { kind: 'contact'; contactId: Id<'contacts'> };

export function assigneeOptionValue(assignee: TaskAssignee | undefined): string {
	if (!assignee) return ASSIGNEE_UNASSIGNED;
	return assignee.kind === 'user' ? `user:${assignee.userId}` : `contact:${assignee.contactId}`;
}

/** `null` means "unassigned", which is a choice the picker offers explicitly. */
export function parseAssigneeOption(value: string): TaskAssigneeWrite | null {
	if (value.startsWith('user:')) return { kind: 'user', userId: value.slice('user:'.length) };
	if (value.startsWith('contact:')) {
		return { kind: 'contact', contactId: value.slice('contact:'.length) as Id<'contacts'> };
	}
	return null;
}
