import type { FunctionReturnType } from 'convex/server';
import type { api } from '$convex/_generated/api';

export type PipelineStage = FunctionReturnType<
	typeof api.pipelineStages.queries.listStages
>[number];

export type CostTemplate = FunctionReturnType<
	typeof api.costTemplates.queries.listCostTemplates
>[number];

export type TaskTemplate = FunctionReturnType<
	typeof api.taskTemplates.queries.listTaskTemplates
>[number];

export type TaskTemplateItem = TaskTemplate['items'][number];

/**
 * Which checklist a template version belongs to. A campaign keeps one active
 * version of EACH — its record checklist and its trip checklist are different
 * lists of different work. Re-exported from the model so the settings UI and
 * the write path cannot drift apart on the spelling.
 */
export type { TaskTemplateScope } from '$convex/model/tasks';

export type TripBudgetTemplate = FunctionReturnType<
	typeof api.tripBudgetTemplates.queries.listTripBudgetTemplates
>[number];

export type FieldCategory = FunctionReturnType<
	typeof api.customFields.queries.listCategories
>[number];

export type FieldDefinitionRow = FunctionReturnType<
	typeof api.customFields.queries.listFieldDefinitions
>[number];
