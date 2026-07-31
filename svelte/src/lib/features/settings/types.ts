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

export type FieldCategory = FunctionReturnType<
	typeof api.customFields.queries.listCategories
>[number];

export type FieldDefinitionRow = FunctionReturnType<
	typeof api.customFields.queries.listFieldDefinitions
>[number];
