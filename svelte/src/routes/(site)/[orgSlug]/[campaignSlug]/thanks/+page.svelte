<script lang="ts">
	// Where a donor lands after paying.
	//
	// This page SUBSCRIBES to the donation row rather than polling Stripe, which
	// is what every Stripe example does. We already have reactivity, so the
	// status updates by itself the moment the webhook lands — no timer, no
	// refresh button, and no window where the donor is told something that is
	// not yet true.
	//
	// That last point is the reason the copy is careful. Stripe appends
	// `payment_intent` to the return URL but NOT the connected account id, so
	// `retrievePaymentIntent` could not be used here anyway; our own donation id
	// arrives as `?d=` and resolves everything. And for an ACH gift the honest
	// answer really is "we're confirming this" for several days — asserting
	// "your donation has been received" would be a claim we cannot support.

	import { page } from '$app/state';
	import { useQuery } from '@mmailaender/convex-svelte';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { formatCents } from '$lib/features/money/format';
	import * as m from '$lib/i18n/messages';

	const donationIntentId = $derived(page.url.searchParams.get('d'));

	const giftResponse = useQuery(api.stripe.donations.getGiftStatus, () =>
		donationIntentId ? { donationIntentId: donationIntentId as Id<'donationIntents'> } : 'skip'
	);
	const gift = $derived(giftResponse.data ?? null);
</script>

<svelte:head>
	<title>{m.publicSite_thanksTitle()}</title>
	<!-- A receipt page has no business in an index, and the id in the URL is
	     one a search engine should never be handed. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<section class="mx-auto max-w-xl px-4 py-16 text-center">
	<h1 class="text-3xl font-bold tracking-tight">{m.publicSite_thanksTitle()}</h1>

	<div class="mt-4 space-y-3">
		{#if !gift}
			<p class="text-muted-foreground">{m.publicSite_thanksConfirming()}</p>
		{:else if gift.status === 'succeeded'}
			<p>{m.publicSite_thanksConfirmed({ amount: formatCents(gift.chargedCents) })}</p>
			{#if gift.receiptNumber}
				<p class="text-muted-foreground text-sm">
					{m.publicSite_thanksReceiptNumber({ number: gift.receiptNumber })}
				</p>
			{/if}
		{:else if gift.status === 'processing'}
			<!-- Bank debits settle in days, not seconds. Saying "received" here
			     would be wrong, and the receipt genuinely cannot be issued until
			     the money actually arrives. -->
			<p class="text-muted-foreground">{m.publicSite_thanksProcessing()}</p>
		{:else if gift.status === 'failed'}
			<p class="text-destructive">{m.publicSite_thanksFailed()}</p>
		{:else}
			<p class="text-muted-foreground">{m.publicSite_thanksConfirming()}</p>
		{/if}
	</div>
</section>
