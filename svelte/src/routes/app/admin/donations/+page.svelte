<script lang="ts">
	// Online giving ACTIVITY, as distinct from `/app/admin/giving`, which is the
	// owner-only Stripe configuration page.
	//
	// The split is about audience, not tidiness. Connecting a Stripe account
	// decides where an organization's money lands, so it is `billing:manage` and
	// owner-only. Watching gifts arrive, reconciling a bank deposit and
	// refunding a duplicate donation is a bookkeeper's job — very often an admin
	// rather than the owner — so it gates on `money:read`, with the refund
	// action itself behind `money:write`.

	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';

	import GiftsTable from '$lib/features/giving-admin/GiftsTable.svelte';
	import PayoutsCard from '$lib/features/giving-admin/PayoutsCard.svelte';
	import DisputesCard from '$lib/features/giving-admin/DisputesCard.svelte';
	import * as m from '$lib/i18n/messages';

	const access = getAccessContext();

	// Org-wide, with no campaignId: this page lists gifts across every campaign,
	// so the question is "may they read money anywhere at all". Each refund
	// button then re-gates on its own gift's campaign.
	const canRead = $derived(access.can('money:read'));
</script>

<PageContainer title={m.donations_title()} description={m.donations_subtitle()} access={canRead}>
	<!-- Payouts and disputes lead, because both are things that have gone wrong
	     and are invisible elsewhere: a failed payout means donations cannot
	     reach the bank, and a dispute carries a deadline that passes in
	     silence. The gift list is the reference table you scroll to. -->
	<div class="grid gap-4 lg:grid-cols-2">
		<PayoutsCard {canRead} />
		<DisputesCard {canRead} />
	</div>

	<GiftsTable {canRead} />
</PageContainer>
