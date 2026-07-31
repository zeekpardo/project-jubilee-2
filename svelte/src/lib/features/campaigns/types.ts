import type { FunctionReturnType } from 'convex/server';
import type { api } from '$convex/_generated/api';

export type Campaign = FunctionReturnType<typeof api.campaigns.queries.listCampaigns>[number];
