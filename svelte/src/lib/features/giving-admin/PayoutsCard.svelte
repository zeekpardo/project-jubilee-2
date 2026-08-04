<script lang="ts">
	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { api } from '$convex/_generated/api';
	import { formatCents } from '$lib/features/money/format';
	import * as m from '$lib/i18n/messages';

	let { canRead }: { canRead: boolean } = $props();

	const auth = useAuth();
	const response = useQuery(api.stripe.queries.listPayouts, () =>
		auth.isAuthenticated && canRead ? {} : 'skip'
	);
	const payouts = $derived(response.data ?? []);

	// The one that matters. A failed payout means gifts are piling up in a
	// balance the org cannot reach — almost always a mistyped bank account —
	// and nothing else in the product would ever tell them.
	const failed = $derived(payouts.filter((payout) => payout.status === 'failed'));

	const STATUS_LABELS: Record<string, () => string> = {
		pending: m.donations_payoutStatus_pending,
		in_transit: m.donations_payoutStatus_in_transit,
		paid: m.donations_payoutStatus_paid,
		canceled: m.donations_payoutStatus_canceled,
		failed: m.donations_payoutStatus_failed
	};

	const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
		pending: 'outline',
		in_transit: 'secondary',
		paid: 'default',
		canceled: 'secondary',
		failed: 'destructive'
	};
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="text-base">{m.donations_payoutsTitle()}</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		{#if failed.length > 0}
			<div class="border-destructive/40 bg-destructive/5 rounded-lg border p-3">
				<p class="text-sm font-medium">{m.donations_payoutFailedTitle()}</p>
				<p class="text-muted-foreground mt-1 text-sm">{m.donations_payoutFailedBody()}</p>
				{#if failed[0].failureMessage}
					<p class="text-muted-foreground mt-1 font-mono text-xs">
						{failed[0].failureMessage}
					</p>
				{/if}
			</div>
		{/if}

		{#if payouts.length === 0}
			<p class="text-muted-foreground text-sm">{m.donations_payoutsEmpty()}</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each payouts as payout (payout._id)}
					<li class="flex flex-wrap items-center justify-between gap-2 text-sm">
						<div class="flex items-center gap-2">
							<span class="font-medium tabular-nums">{formatCents(payout.amountCents)}</span>
							<Badge variant={STATUS_VARIANTS[payout.status] ?? 'secondary'}>
								{STATUS_LABELS[payout.status]?.() ?? payout.status}
							</Badge>
						</div>
						<span class="text-muted-foreground text-xs">
							{#if payout.arrivalDate && payout.status !== 'paid'}
								{m.donations_payoutArrival({
									date: new Date(payout.arrivalDate).toLocaleDateString()
								})}
							{:else}
								{new Date(payout.createdAt).toLocaleDateString()}
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</Card.Content>
</Card.Root>
