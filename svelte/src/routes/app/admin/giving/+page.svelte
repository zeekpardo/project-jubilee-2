<script lang="ts">
	// Shell
	import PageContainer from '$lib/shell/PageContainer.svelte';
	// Access
	import { getAccessContext } from '$lib/access';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	// Feature
	import ConnectCard from '$lib/features/giving-admin/ConnectCard.svelte';
	import WalletsCard from '$lib/features/giving-admin/WalletsCard.svelte';
	import FeeConfigCard from '$lib/features/giving-admin/FeeConfigCard.svelte';
	import ReceiptDetailsCard from '$lib/features/giving-admin/ReceiptDetailsCard.svelte';
	import NonprofitRateCard from '$lib/features/giving-admin/NonprofitRateCard.svelte';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();

	// billing:manage is owner-only. Deliberately stricter than the org:manage
	// pages this sits beside in the nav: those change how the org presents
	// itself, this one decides which bank account its donations land in.
	const allowed = $derived(access.can('billing:manage'));

	const accountResponse = useQuery(api.stripe.queries.getConnectAccount, () =>
		auth.isAuthenticated && allowed ? {} : 'skip'
	);
	const account = $derived(accountResponse.data ?? null);

	const settingsResponse = useQuery(api.orgSettings.queries.getOrgSettings, () =>
		auth.isAuthenticated && allowed ? {} : 'skip'
	);
	const settings = $derived(settingsResponse.data ?? null);
</script>

<PageContainer
	title={m.giving_title()}
	description={m.giving_subtitle()}
	access={allowed}
	loading={accountResponse.isLoading}
>
	<ConnectCard {account} />

	{#if account}
		<!--
			Only once an account exists. Every card below configures something
			about an account, and rendering them empty next to a "Connect with
			Stripe" button would read as though setup were optional.

			Receipt details are the exception in spirit — they are needed before
			the FIRST gift, not after — but an org with no Stripe account has no
			gifts to acknowledge either, so the ordering holds.
		-->
		<WalletsCard {account} />
		<FeeConfigCard {account} />
		<ReceiptDetailsCard {settings} />
	{/if}

	<NonprofitRateCard />
</PageContainer>
