import { ConvexError } from 'convex/values';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { campaignStages } from './projects';

/** The project a document hangs off, verified to belong to the caller's org. */
export async function requireDocumentProject(
	ctx: MutationCtx,
	orgId: string,
	projectId: Id<'projects'>
): Promise<Doc<'projects'>> {
	const project = await ctx.db.get('projects', projectId);
	if (!project || project.orgId !== orgId) {
		throw new ConvexError('Project not found');
	}
	return project;
}

/** A document evidences a stage, so the key must exist on its campaign. */
export async function assertStage(
	ctx: MutationCtx,
	project: Doc<'projects'>,
	stage: string
): Promise<void> {
	const stages = await campaignStages(ctx, project.campaignId);
	if (!stages.some((candidate) => candidate.key === stage)) {
		throw new ConvexError(`Invalid stage: ${stage}`);
	}
}

export function assertAmountCents(amountCents: number | undefined): void {
	if (amountCents === undefined) {
		return;
	}
	if (!Number.isInteger(amountCents)) {
		throw new ConvexError('amountCents must be an integer number of cents');
	}
	if (amountCents < 0) {
		throw new ConvexError('amountCents must not be negative');
	}
}
