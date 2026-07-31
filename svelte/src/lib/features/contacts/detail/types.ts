import type { FunctionReturnType } from 'convex/server';
import type { api } from '$convex/_generated/api';

export type ContactDetail = FunctionReturnType<typeof api.contacts.queries.getContact>;
export type ContactHouseholds = FunctionReturnType<
	typeof api.contacts.detail.listHouseholdsForContact
>;
export type ContactGiving = FunctionReturnType<typeof api.contacts.detail.listDonationsForContact>;
export type ContactCampaigns = FunctionReturnType<
	typeof api.campaignMembers.queries.listCampaignsForContact
>;
export type ContactProjects = FunctionReturnType<
	typeof api.projectMembers.queries.listProjectsForContact
>;
