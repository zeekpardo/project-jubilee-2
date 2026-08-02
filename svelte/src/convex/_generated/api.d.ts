/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access_mutations from "../access/mutations.js";
import type * as access_queries from "../access/queries.js";
import type * as allocations_mutations from "../allocations/mutations.js";
import type * as allocations_queries from "../allocations/queries.js";
import type * as auth from "../auth.js";
import type * as budgets_mutations from "../budgets/mutations.js";
import type * as budgets_queries from "../budgets/queries.js";
import type * as campaignMembers_mutations from "../campaignMembers/mutations.js";
import type * as campaignMembers_queries from "../campaignMembers/queries.js";
import type * as campaigns_detail from "../campaigns/detail.js";
import type * as campaigns_mutations from "../campaigns/mutations.js";
import type * as campaigns_queries from "../campaigns/queries.js";
import type * as contacts_detail from "../contacts/detail.js";
import type * as contacts_mutations from "../contacts/mutations.js";
import type * as contacts_queries from "../contacts/queries.js";
import type * as costTemplates_mutations from "../costTemplates/mutations.js";
import type * as costTemplates_queries from "../costTemplates/queries.js";
import type * as customFields_mutations from "../customFields/mutations.js";
import type * as customFields_queries from "../customFields/queries.js";
import type * as deviceAuthorization from "../deviceAuthorization.js";
import type * as documents_mutations from "../documents/mutations.js";
import type * as documents_queries from "../documents/queries.js";
import type * as email from "../email.js";
import type * as households_mutations from "../households/mutations.js";
import type * as households_queries from "../households/queries.js";
import type * as http from "../http.js";
import type * as migrations from "../migrations.js";
import type * as model_access from "../model/access.js";
import type * as model_auth from "../model/auth.js";
import type * as model_budgets from "../model/budgets.js";
import type * as model_campaigns from "../model/campaigns.js";
import type * as model_cascade from "../model/cascade.js";
import type * as model_contacts from "../model/contacts.js";
import type * as model_customFields from "../model/customFields.js";
import type * as model_documents from "../model/documents.js";
import type * as model_emails_templates_baseEmail from "../model/emails/templates/baseEmail.js";
import type * as model_emails_templates_emailTemplates from "../model/emails/templates/emailTemplates.js";
import type * as model_emails_validateEmail from "../model/emails/validateEmail.js";
import type * as model_fields from "../model/fields.js";
import type * as model_memberships from "../model/memberships.js";
import type * as model_money from "../model/money.js";
import type * as model_organizations_index from "../model/organizations/index.js";
import type * as model_policy from "../model/policy.js";
import type * as model_projects from "../model/projects.js";
import type * as model_public from "../model/public.js";
import type * as model_stats from "../model/stats.js";
import type * as model_tasks from "../model/tasks.js";
import type * as orgSettings_mutations from "../orgSettings/mutations.js";
import type * as orgSettings_queries from "../orgSettings/queries.js";
import type * as organizations_invitations_queries from "../organizations/invitations/queries.js";
import type * as organizations_members_mutations from "../organizations/members/mutations.js";
import type * as organizations_mutations from "../organizations/mutations.js";
import type * as organizations_queries from "../organizations/queries.js";
import type * as pipelineStages_mutations from "../pipelineStages/mutations.js";
import type * as pipelineStages_queries from "../pipelineStages/queries.js";
import type * as projectMembers_mutations from "../projectMembers/mutations.js";
import type * as projectMembers_queries from "../projectMembers/queries.js";
import type * as projects_detail from "../projects/detail.js";
import type * as projects_mutations from "../projects/mutations.js";
import type * as projects_queries from "../projects/queries.js";
import type * as public_queries from "../public/queries.js";
import type * as seed from "../seed.js";
import type * as seed_jubilee from "../seed/jubilee.js";
import type * as seed_transform from "../seed/transform.js";
import type * as storage from "../storage.js";
import type * as taskTemplates_mutations from "../taskTemplates/mutations.js";
import type * as taskTemplates_queries from "../taskTemplates/queries.js";
import type * as tasks_mutations from "../tasks/mutations.js";
import type * as tasks_queries from "../tasks/queries.js";
import type * as transactions_donation from "../transactions/donation.js";
import type * as transactions_mutations from "../transactions/mutations.js";
import type * as transactions_queries from "../transactions/queries.js";
import type * as transactions_spend from "../transactions/spend.js";
import type * as url from "../url.js";
import type * as users_actions from "../users/actions.js";
import type * as users_mutations from "../users/mutations.js";
import type * as users_queries from "../users/queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "access/mutations": typeof access_mutations;
  "access/queries": typeof access_queries;
  "allocations/mutations": typeof allocations_mutations;
  "allocations/queries": typeof allocations_queries;
  auth: typeof auth;
  "budgets/mutations": typeof budgets_mutations;
  "budgets/queries": typeof budgets_queries;
  "campaignMembers/mutations": typeof campaignMembers_mutations;
  "campaignMembers/queries": typeof campaignMembers_queries;
  "campaigns/detail": typeof campaigns_detail;
  "campaigns/mutations": typeof campaigns_mutations;
  "campaigns/queries": typeof campaigns_queries;
  "contacts/detail": typeof contacts_detail;
  "contacts/mutations": typeof contacts_mutations;
  "contacts/queries": typeof contacts_queries;
  "costTemplates/mutations": typeof costTemplates_mutations;
  "costTemplates/queries": typeof costTemplates_queries;
  "customFields/mutations": typeof customFields_mutations;
  "customFields/queries": typeof customFields_queries;
  deviceAuthorization: typeof deviceAuthorization;
  "documents/mutations": typeof documents_mutations;
  "documents/queries": typeof documents_queries;
  email: typeof email;
  "households/mutations": typeof households_mutations;
  "households/queries": typeof households_queries;
  http: typeof http;
  migrations: typeof migrations;
  "model/access": typeof model_access;
  "model/auth": typeof model_auth;
  "model/budgets": typeof model_budgets;
  "model/campaigns": typeof model_campaigns;
  "model/cascade": typeof model_cascade;
  "model/contacts": typeof model_contacts;
  "model/customFields": typeof model_customFields;
  "model/documents": typeof model_documents;
  "model/emails/templates/baseEmail": typeof model_emails_templates_baseEmail;
  "model/emails/templates/emailTemplates": typeof model_emails_templates_emailTemplates;
  "model/emails/validateEmail": typeof model_emails_validateEmail;
  "model/fields": typeof model_fields;
  "model/memberships": typeof model_memberships;
  "model/money": typeof model_money;
  "model/organizations/index": typeof model_organizations_index;
  "model/policy": typeof model_policy;
  "model/projects": typeof model_projects;
  "model/public": typeof model_public;
  "model/stats": typeof model_stats;
  "model/tasks": typeof model_tasks;
  "orgSettings/mutations": typeof orgSettings_mutations;
  "orgSettings/queries": typeof orgSettings_queries;
  "organizations/invitations/queries": typeof organizations_invitations_queries;
  "organizations/members/mutations": typeof organizations_members_mutations;
  "organizations/mutations": typeof organizations_mutations;
  "organizations/queries": typeof organizations_queries;
  "pipelineStages/mutations": typeof pipelineStages_mutations;
  "pipelineStages/queries": typeof pipelineStages_queries;
  "projectMembers/mutations": typeof projectMembers_mutations;
  "projectMembers/queries": typeof projectMembers_queries;
  "projects/detail": typeof projects_detail;
  "projects/mutations": typeof projects_mutations;
  "projects/queries": typeof projects_queries;
  "public/queries": typeof public_queries;
  seed: typeof seed;
  "seed/jubilee": typeof seed_jubilee;
  "seed/transform": typeof seed_transform;
  storage: typeof storage;
  "taskTemplates/mutations": typeof taskTemplates_mutations;
  "taskTemplates/queries": typeof taskTemplates_queries;
  "tasks/mutations": typeof tasks_mutations;
  "tasks/queries": typeof tasks_queries;
  "transactions/donation": typeof transactions_donation;
  "transactions/mutations": typeof transactions_mutations;
  "transactions/queries": typeof transactions_queries;
  "transactions/spend": typeof transactions_spend;
  url: typeof url;
  "users/actions": typeof users_actions;
  "users/mutations": typeof users_mutations;
  "users/queries": typeof users_queries;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
