import type { Doc } from '$convex/_generated/dataModel';
import type { PipelineStage } from '$lib/domain/stages';
import type { BadgeVariant } from '$lib/primitives/ui/badge';

/** Stage rows as the pure domain helpers expect them. */
export function toStages(rows: Doc<'pipelineStages'>[] | undefined): PipelineStage[] {
	return (rows ?? []).map((row) => ({
		key: row.key,
		label: row.label,
		order: row.order,
		kind: row.kind,
		accent: row.accent ?? null,
		isDefault: row.isDefault,
		isFundedGate: row.isFundedGate,
		isSystem: row.isSystem
	}));
}

const ACCENT_VARIANTS: Record<string, BadgeVariant> = {
	amber: 'warning',
	yellow: 'warning',
	orange: 'warning',
	red: 'destructive',
	rose: 'destructive',
	green: 'success',
	emerald: 'success',
	teal: 'success'
};

/** Badge variant for a stage's accent token, falling back on its kind. */
export function stageVariant(stage: PipelineStage | undefined): BadgeVariant {
	if (!stage) return 'outline';
	const accent = stage.accent ? ACCENT_VARIANTS[stage.accent] : undefined;
	if (accent) return accent;
	return stage.kind === 'terminal' ? 'outline' : 'secondary';
}
