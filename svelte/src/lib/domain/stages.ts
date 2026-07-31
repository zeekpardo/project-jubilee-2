// Pure stage helpers — no db imports. Pipeline stages are an ADMIN-MANAGED
// model (the pipeline_stages table); a project's `stage` is a stage KEY (slug).
// This module holds the shared types + pure helpers that operate over a fetched
// stage list. The list itself comes from the pipeline stage queries.

/** A pipeline stage key (slug), e.g. "vetted". Not a fixed union any more. */
export type ProjectStage = string;

export type PipelineStageKind = 'funnel' | 'terminal';

/** A pipeline stage, as configured in the pipeline_stages table. */
export interface PipelineStage {
	key: string;
	label: string;
	order: number;
	kind: PipelineStageKind;
	/** Color token for the badge / kanban header (e.g. 'amber'), or null. */
	accent: string | null;
	/** Where newly-created projects start. */
	isDefault: boolean;
	/** Triggers the "fully funded → start transfer" task + "Fully funded" label. */
	isFundedGate: boolean;
	/** Protected original stage — relabel/recolor/reorder only, no delete. */
	isSystem: boolean;
}

export interface StageSetResult {
	allowed: boolean;
	reason?: string;
}

/**
 * Guard a MANUAL stage set. Any known stage may be set to any other (the
 * pipeline stage is a free admin-set status). Rejections are structural only:
 * an empty/unknown key (when `validKeys` is provided), or a no-op set to the
 * current stage. `validKeys` should be the configured stage keys.
 */
export function canSetStage(
	current: ProjectStage,
	next: ProjectStage,
	validKeys?: Iterable<string>
): StageSetResult {
	if (!next) return { allowed: false, reason: 'Invalid stage' };
	if (validKeys && ![...validKeys].includes(next)) {
		return { allowed: false, reason: `Invalid stage: ${next}` };
	}
	if (current === next) return { allowed: false, reason: 'Already in this stage' };
	return { allowed: true };
}

// ---------------------------------------------------------------------------
// Pure helpers over a stage list (works client- and server-side).
// ---------------------------------------------------------------------------

const byOrder = (a: PipelineStage, b: PipelineStage) => a.order - b.order;

/** Funnel stages (non-terminal), in order. */
export function funnelStages(stages: PipelineStage[]): PipelineStage[] {
	// [...].sort() rather than .toSorted() — same semantics (new array, stable
	// sort, no mutation), but toSorted is ES2023 and the Convex tsc program
	// (src/convex/tsconfig.json) pins lib to ES2021.
	// (.filter already returns a fresh array, so .sort does not mutate `stages`.)
	return stages.filter((s) => s.kind === 'funnel').sort(byOrder);
}

/** Keys of the terminal off-ramp stages (cancelled / freed-by-other, etc.). */
export function terminalStageKeys(stages: PipelineStage[]): string[] {
	return stages.filter((s) => s.kind === 'terminal').map((s) => s.key);
}

/** The key new projects start in (isDefault, else the first funnel stage). */
export function defaultStageKey(stages: PipelineStage[]): string {
	return stages.find((s) => s.isDefault)?.key ?? funnelStages(stages)[0]?.key ?? 'identified';
}

/** The funded-gate stage key (triggers the transfer task), or null. */
export function fundedGateKey(stages: PipelineStage[]): string | null {
	return stages.find((s) => s.isFundedGate)?.key ?? null;
}

/** Display label for a stage key (falls back to the key). */
export function stageLabel(stages: PipelineStage[], key: string): string {
	return stages.find((s) => s.key === key)?.label ?? key;
}
