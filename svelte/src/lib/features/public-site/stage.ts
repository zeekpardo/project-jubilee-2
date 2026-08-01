// Donor-facing status language for public projects. Ports the reference
// project's `lib/stage.ts`, adapted to this repo's model: instead of a
// pipeline `stage` + `isFreed` flag, PublicProject carries `isGoalMet` (an
// independent admin toggle) and a campaign-configurable `goalLabel` (e.g.
// "Freed") for the wording that flag surfaces. Every other pipeline stage
// collapses into one of two generic donor states — there is no third,
// pipeline-specific label shown to donors.

import { formatCents } from '$lib/features/money/format';
import * as m from '$lib/i18n/messages';

/** True once a record's raised total has reached (or passed) its target. */
export function isFullyFunded(progress: number | null): boolean {
	return progress !== null && progress >= 1;
}

/**
 * Donor-facing status label for a project. A goal-met record shows the
 * campaign's own wording; a record that has reached its target without
 * being marked goal-met reads as "Fully funded"; everything else reads as
 * "Awaiting sponsor".
 */
export function publicStatusLabel(
	isGoalMet: boolean,
	goalLabel: string,
	progress: number | null
): string {
	if (isGoalMet) return goalLabel;
	if (isFullyFunded(progress)) return m.publicSite_fullyFunded();
	return m.publicSite_awaitingSponsor();
}

/** Short "complete" badge text used by FundingProgress once funding is done. */
export function fundingCompleteLabel(isGoalMet: boolean, goalLabel: string): string {
	return isGoalMet
		? m.publicSite_goalMetFullyFunded({ goal: goalLabel })
		: m.publicSite_fullyFunded();
}

/**
 * The stage-aware sentence FundingProgress renders in its full (non-compact)
 * variant — ported from the object detail page in the reference project.
 */
export function fundingSentence(args: {
	isGoalMet: boolean;
	progress: number | null;
	goalLabel: string;
	objectLabel: string;
	targetCents: number | null;
	raisedCents: number;
}): string {
	const object = args.objectLabel.toLowerCase();

	if (args.isGoalMet) {
		return m.publicSite_fundingGoalMetSentence({ object, goal: args.goalLabel.toLowerCase() });
	}
	if (isFullyFunded(args.progress)) {
		return m.publicSite_fundingFundedExtraSentence({ object });
	}
	const remainingCents =
		args.targetCents !== null ? Math.max(args.targetCents - args.raisedCents, 0) : 0;
	if (args.targetCents !== null && remainingCents > 0) {
		return m.publicSite_fundingRemainingSentence({
			amount: formatCents(remainingCents),
			object
		});
	}
	return m.publicSite_fundingForwardSentence({ object });
}
