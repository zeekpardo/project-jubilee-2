// Row types are DERIVED from the query return types, never hand-written — the
// same contract features/trips/types.ts keeps. A column renamed server-side
// surfaces as a type error here instead of silently rendering blank.

import type { FunctionReturnType } from 'convex/server';
import type { api } from '$convex/_generated/api';
import type { Doc } from '$convex/_generated/dataModel';

export type CheckinRow = FunctionReturnType<typeof api.checkins.queries.listCheckins>[number];

/** The whole trace behind one conversation. Null when the viewer may not read it. */
export type CheckinDetail = NonNullable<FunctionReturnType<typeof api.checkins.queries.getCheckin>>;

export type EscalationRow = FunctionReturnType<typeof api.checkins.queries.listEscalations>[number];

export type PromptVersionRow = FunctionReturnType<
	typeof api.checkins.queries.listPromptVersions
>[number];

export type CheckinSettings = FunctionReturnType<typeof api.checkins.queries.checkinSettings>;

export type CheckinMessageRow = CheckinDetail['messages'][number];
export type ConversationTurnRow = CheckinDetail['turns'][number];
export type ObjectiveCheckRow = CheckinDetail['checks'][number];
export type ObjectiveStateRow = CheckinDetail['objectiveStates'][number];
export type CheckinDecision = CheckinDetail['nextDecision'];

export type CheckinStatus = Doc<'checkinConversations'>['status'];

/**
 * What kind of conversation a row is: `direct` (people talking, staff write
 * every outbound message) or `checkin` (the engine owns the thread).
 *
 * The column is optional on the document because it was added to a table that
 * already had rows in it, and every one of those was a check-in. `NonNullable`
 * is therefore the honest type: absent is not a third kind, it is `checkin`
 * written before the column existed. Read it through `conversationKind` and
 * never as `row.kind` directly — a bare read types as `undefined` and renders
 * an engine-run conversation as neither.
 */
export type CheckinKind = NonNullable<Doc<'checkinConversations'>['kind']>;

/** The one place the absent-means-`checkin` rule is spelled out. */
export function conversationKind(row: { kind?: CheckinKind }): CheckinKind {
	return row.kind ?? 'checkin';
}
export type CheckinReviewReason = NonNullable<Doc<'checkinConversations'>['reviewReason']>;
export type EscalationCategory = Doc<'checkinEscalations'>['category'];
export type EscalationStatus = Doc<'checkinEscalations'>['status'];
export type PromptRole = Doc<'promptVersions'>['role'];
export type ObjectiveState = ObjectiveStateRow['state'];
