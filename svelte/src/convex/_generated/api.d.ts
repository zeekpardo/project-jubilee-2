/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as campaigns_mutations from "../campaigns/mutations.js";
import type * as campaigns_queries from "../campaigns/queries.js";
import type * as costTemplates_mutations from "../costTemplates/mutations.js";
import type * as costTemplates_queries from "../costTemplates/queries.js";
import type * as deviceAuthorization from "../deviceAuthorization.js";
import type * as email from "../email.js";
import type * as http from "../http.js";
import type * as migrations from "../migrations.js";
import type * as model_campaigns from "../model/campaigns.js";
import type * as model_emails_templates_baseEmail from "../model/emails/templates/baseEmail.js";
import type * as model_emails_templates_emailTemplates from "../model/emails/templates/emailTemplates.js";
import type * as model_emails_validateEmail from "../model/emails/validateEmail.js";
import type * as model_organizations_index from "../model/organizations/index.js";
import type * as model_projects from "../model/projects.js";
import type * as orgSettings_mutations from "../orgSettings/mutations.js";
import type * as orgSettings_queries from "../orgSettings/queries.js";
import type * as organizations_invitations_queries from "../organizations/invitations/queries.js";
import type * as organizations_members_mutations from "../organizations/members/mutations.js";
import type * as organizations_mutations from "../organizations/mutations.js";
import type * as organizations_queries from "../organizations/queries.js";
import type * as pipelineStages_mutations from "../pipelineStages/mutations.js";
import type * as pipelineStages_queries from "../pipelineStages/queries.js";
import type * as projects_mutations from "../projects/mutations.js";
import type * as projects_queries from "../projects/queries.js";
import type * as seed from "../seed.js";
import type * as storage from "../storage.js";
import type * as taskTemplates_mutations from "../taskTemplates/mutations.js";
import type * as taskTemplates_queries from "../taskTemplates/queries.js";
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
  auth: typeof auth;
  "campaigns/mutations": typeof campaigns_mutations;
  "campaigns/queries": typeof campaigns_queries;
  "costTemplates/mutations": typeof costTemplates_mutations;
  "costTemplates/queries": typeof costTemplates_queries;
  deviceAuthorization: typeof deviceAuthorization;
  email: typeof email;
  http: typeof http;
  migrations: typeof migrations;
  "model/campaigns": typeof model_campaigns;
  "model/emails/templates/baseEmail": typeof model_emails_templates_baseEmail;
  "model/emails/templates/emailTemplates": typeof model_emails_templates_emailTemplates;
  "model/emails/validateEmail": typeof model_emails_validateEmail;
  "model/organizations/index": typeof model_organizations_index;
  "model/projects": typeof model_projects;
  "orgSettings/mutations": typeof orgSettings_mutations;
  "orgSettings/queries": typeof orgSettings_queries;
  "organizations/invitations/queries": typeof organizations_invitations_queries;
  "organizations/members/mutations": typeof organizations_members_mutations;
  "organizations/mutations": typeof organizations_mutations;
  "organizations/queries": typeof organizations_queries;
  "pipelineStages/mutations": typeof pipelineStages_mutations;
  "pipelineStages/queries": typeof pipelineStages_queries;
  "projects/mutations": typeof projects_mutations;
  "projects/queries": typeof projects_queries;
  seed: typeof seed;
  storage: typeof storage;
  "taskTemplates/mutations": typeof taskTemplates_mutations;
  "taskTemplates/queries": typeof taskTemplates_queries;
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
