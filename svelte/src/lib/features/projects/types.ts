import type { FunctionReturnType } from 'convex/server';
import type { api } from '$convex/_generated/api';

export type ProjectMemberRow = FunctionReturnType<
	typeof api.projectMembers.queries.listMembersForProject
>[number];

export type ProjectDocumentRow = FunctionReturnType<
	typeof api.documents.queries.listDocumentsForProject
>[number];

export type CostTemplateRow = FunctionReturnType<
	typeof api.costTemplates.queries.listCostTemplates
>[number];

export type ProjectFieldDefinition = FunctionReturnType<
	typeof api.customFields.queries.resolveFields
>[number];
