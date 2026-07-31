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

export type ContactInfo = FunctionReturnType<typeof api.contacts.detail.listContactInfo>;
export type ContactEmailRow = ContactInfo['emails'][number];
export type ContactPhoneRow = ContactInfo['phones'][number];
export type ContactAddressRow = ContactInfo['addresses'][number];
export type ContactBackgroundCheckRow = ContactInfo['backgroundChecks'][number];
