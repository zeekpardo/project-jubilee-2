<script lang="ts">
	// Stripe sends an org here when an Account Link expired or was already
	// used — they are five minutes long and single-use, so this is a normal
	// occurrence rather than an error, and it happens to anyone who leaves the
	// tab open while finding a document.
	//
	// The only correct response is to mint a fresh link and redirect straight
	// back into the flow. Showing a "your link expired, click here" page would
	// add a click to a journey that is already too long.

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
				const { url } = await client.action(api.stripe.accounts.createOnboardingLink, {
					origin: window.location.origin
				});
				window.location.href = url;
			} catch {
				// If a fresh link cannot be minted, the settings page can explain
				// the account's actual state and offer the button again.
				await goto(resolve('/app/admin/giving'), { replaceState: true });
			}
		})();
	});
</script>

<PageContainer title={m.giving_returnTitle()} description={m.giving_returnBody()}>
	<div class="flex justify-center py-12">
		<Spinner />
	</div>
</PageContainer>
