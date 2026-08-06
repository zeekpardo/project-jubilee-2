<script lang="ts">
	// The §13 correction surface: a report that writes nothing until someone
	// says so, with the before/after on screen before the button is.
	//
	// Org-wide rather than campaign-scoped, and gated on settings:manage: it
	// shows what happens to numbers a donor may already have seen, across every
	// campaign in the org. That is not the same question as "may this person
	// edit this campaign's records".
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import MemberSideCampaignList from '$lib/features/member-sides/MemberSideCampaignList.svelte';
	import MemberSideReport from '$lib/features/member-sides/MemberSideReport.svelte';
	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();

	const allowed = $derived(access.can('settings:manage'));

	const campaignsResponse = useQuery(api.projectMembers.audit.listAuditCampaigns, () =>
		auth.isAuthenticated && allowed ? {} : 'skip'
	);
	const campaigns = $derived(campaignsResponse.data ?? []);
	const loading = $derived(campaignsResponse.isLoading);

	let selectedId = $state<Id<'campaigns'> | null>(null);

	// Nothing is preselected. The picker is the first decision — see §13's "one
	// campaign at a time" — and landing on a campaign nobody chose would put a
	// set of before/after numbers on screen for a campaign the admin was not
	// asking about.
	const selected = $derived(
		campaigns.find((campaign) => campaign.campaignId === selectedId) ? selectedId : null
	);
</script>

<PageContainer
	title={m.memberSides_title()}
	description={m.memberSides_subtitle()}
	access={allowed}
>
	{#if loading}
		<Skeleton class="h-64 w-full" />
	{:else if campaigns.length === 0}
		<EmptyState title={m.memberSides_nothingTitle()} description={m.memberSides_nothingBody()} />
	{:else}
		<p class="text-muted-foreground max-w-3xl text-sm">{m.memberSides_intro()}</p>

		<div class="grid min-w-0 gap-4 md:grid-cols-[minmax(14rem,18rem)_1fr]">
			<div class="min-w-0">
				<MemberSideCampaignList
					{campaigns}
					selectedId={selected}
					onSelect={(id) => (selectedId = id)}
				/>
			</div>

			<div class="flex min-w-0 flex-col gap-4">
				{#if selected}
					<!-- Keyed on the campaign so switching campaigns starts a clean
					     decision: the ticks, and therefore the projected numbers, never
					     carry over from a campaign the admin has moved on from. -->
					{#key selected}
						<MemberSideReport campaignId={selected} />
					{/key}
				{:else}
					<EmptyState
						title={m.memberSides_selectCampaignTitle()}
						description={m.memberSides_selectCampaignBody()}
					/>
				{/if}
			</div>
		</div>
	{/if}
</PageContainer>
