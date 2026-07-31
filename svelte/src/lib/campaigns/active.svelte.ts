import { getContext, setContext } from 'svelte';
import { browser } from '$app/environment';

export const ACTIVE_CAMPAIGN_COOKIE = 'active_campaign';

export type CampaignSummary = {
	_id: string;
	name: string;
	slug: string;
	objectLabel: string;
	objectLabelPlural: string;
	status: 'active' | 'paused' | 'archived';
};

const ACTIVE_CAMPAIGN_KEY = Symbol('activeCampaign');

/**
 * The campaign the admin is currently working in. Almost every screen is
 * campaign-scoped, and a team leader may only ever see the campaigns they are
 * assigned to, so the list here is already filtered by the server.
 */
export function createActiveCampaign(
	getCampaigns: () => CampaignSummary[],
	getServerId: () => string | null
) {
	// Null until the user picks one in this session; the server's choice is
	// re-read on every navigation so a changed cookie or lost access wins.
	let picked = $state<string | null>(null);

	const campaigns = $derived(getCampaigns());
	const current = $derived(
		campaigns.find((c) => c._id === picked) ??
			campaigns.find((c) => c._id === getServerId()) ??
			campaigns[0] ??
			null
	);

	return {
		get campaigns() {
			return campaigns;
		},
		get current() {
			return current;
		},
		get id() {
			return current?._id ?? null;
		},
		/** What this campaign calls its projects, e.g. "Family" / "Families". */
		get objectLabel() {
			return current?.objectLabel ?? 'Project';
		},
		get objectLabelPlural() {
			return current?.objectLabelPlural ?? 'Projects';
		},
		select(id: string) {
			picked = id;
			if (browser) {
				// Persisted so the server can render the right campaign on the next
				// navigation without a flash of the wrong one.
				document.cookie = `${ACTIVE_CAMPAIGN_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; SameSite=Lax`;
			}
		}
	};
}

export type ActiveCampaign = ReturnType<typeof createActiveCampaign>;

export function setActiveCampaignContext(value: ActiveCampaign): ActiveCampaign {
	return setContext(ACTIVE_CAMPAIGN_KEY, value);
}

export function getActiveCampaignContext(): ActiveCampaign {
	const value = getContext<ActiveCampaign | undefined>(ACTIVE_CAMPAIGN_KEY);
	if (!value) {
		throw new Error('getActiveCampaignContext() called outside of the app layout');
	}
	return value;
}
