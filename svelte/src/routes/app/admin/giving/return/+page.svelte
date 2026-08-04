<script lang="ts">
	// Where Stripe sends an org after hosted onboarding.
	//
	// Reaching this page means "the user came back", and NOTHING more. It is
	// not a completion signal: an org that abandoned the flow halfway hits this
	// exact URL, and so does one that finished. So the only thing this page
	// does is re-fetch the account from Stripe and run it through the same
	// reducer the webhook uses, then hand over to the settings page to render
	// whatever the truth turned out to be.

	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { Spinner } from '$lib/primitives/ui/spinner';
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const client = useConvexClient();

	onMount(() => {
		void (async () => {
			try {
				await client.action(api.stripe.accounts.refreshAccountStatus, {});
			} catch {
				// Swallowed on purpose. The webhook is the primary path for this
				// state and a cron re-syncs regardless, so a failure here costs a
				// few seconds of staleness — not a wrong answer. Stranding the org
				// on a spinner would be the worse outcome.
			}
			await goto(resolve('/app/admin/giving'), { replaceState: true });
		})();
	});
</script>

<PageContainer title={m.giving_returnTitle()} description={m.giving_returnBody()}>
	<div class="flex justify-center py-12">
		<Spinner />
	</div>
</PageContainer>
