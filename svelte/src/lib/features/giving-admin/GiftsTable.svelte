<script lang="ts">
	import * as Card from '$lib/primitives/ui/card';
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import HandCoinsIcon from '@lucide/svelte/icons/hand-coins';

	import { usePaginatedQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { api } from '$convex/_generated/api';
	import { Can } from '$lib/access';
	import { formatCents } from '$lib/features/money/format';
	import * as m from '$lib/i18n/messages';
	import RefundDialog from './RefundDialog.svelte';
	import type { OnlineGift } from './types';

	let { canRead }: { canRead: boolean } = $props();

	const auth = useAuth();

	// Paginated rather than bounded: a successful campaign produces an
	// unbounded number of these, and this is the table that would take an
	// org's admin page down on their biggest giving day.
	const gifts = usePaginatedQuery(
		api.stripe.queries.listOnlineGifts,
		() => (auth.isAuthenticated && canRead ? {} : 'skip'),
		{ initialNumItems: 25 }
	);

	let refundOpen = $state(false);
	let refundTarget = $state<OnlineGift | null>(null);

	function startRefund(gift: OnlineGift): void {
		refundTarget = gift;
		refundOpen = true;
	}

	const STATUS_LABELS: Record<string, () => string> = {
		pending: m.donations_giftStatus_pending,
		processing: m.donations_giftStatus_processing,
		succeeded: m.donations_giftStatus_succeeded,
		failed: m.donations_giftStatus_failed,
		refunded: m.donations_giftStatus_refunded,
		disputed: m.donations_giftStatus_disputed
	};

	const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
		pending: 'outline',
		// Not a success. An ACH debit in flight can still fail days later, so it
		// must not read the same as money in the bank.
		processing: 'secondary',
		succeeded: 'default',
		failed: 'destructive',
		refunded: 'secondary',
		disputed: 'destructive'
	};

	// A refund is only possible once money actually settled and while something
	// is left to give back. The action re-checks all of this; this only keeps
	// the button from appearing where it would always fail.
	function refundable(gift: OnlineGift): boolean {
		return (
			(gift.status === 'succeeded' || gift.status === 'refunded') &&
			gift.chargedCents - gift.refundedCents > 0
		);
	}

	function donorLabel(gift: OnlineGift): string {
		// `anonymous` means "don't show my name publicly" — it is not a secret
		// from the org's own finance staff, who have to reconcile and
		// acknowledge the gift. The badge marks it so nobody publishes the name
		// by accident.
		return gift.donorName?.trim() || gift.donorEmail || m.donations_anonymousDonor();
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="text-base">{m.donations_giftsTitle()}</Card.Title>
	</Card.Header>
	<Card.Content>
		{#if gifts.status === 'LoadingFirstPage'}
			<div class="flex flex-col gap-2">
				{#each Array(5) as _, index (index)}
					<Skeleton class="h-10 w-full" />
				{/each}
			</div>
		{:else if gifts.results.length === 0}
			<EmptyState title={m.donations_empty()}>
				{#snippet icon()}
					<HandCoinsIcon />
				{/snippet}
			</EmptyState>
		{:else}
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>{m.donations_colDate()}</Table.Head>
							<Table.Head>{m.donations_colDonor()}</Table.Head>
							<Table.Head>{m.donations_colCampaign()}</Table.Head>
							<Table.Head class="text-right">{m.donations_colAmount()}</Table.Head>
							<Table.Head>{m.donations_colStatus()}</Table.Head>
							<Table.Head></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each gifts.results as gift (gift._id)}
							<Table.Row>
								<Table.Cell class="whitespace-nowrap">
									{new Date(gift._creationTime).toLocaleDateString()}
								</Table.Cell>
								<Table.Cell>
									<div class="flex flex-wrap items-center gap-1.5">
										<span>{donorLabel(gift)}</span>
										{#if gift.anonymous}
											<Badge variant="outline">{m.donations_anonymousDonor()}</Badge>
										{/if}
										{#if gift.recurring}
											<Badge variant="secondary">{m.donations_recurringBadge()}</Badge>
										{/if}
									</div>
								</Table.Cell>
								<Table.Cell class="text-muted-foreground">{gift.campaignName ?? '—'}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">
									<div>{formatCents(gift.chargedCents)}</div>
									{#if gift.refundedCents > 0}
										<div class="text-muted-foreground text-xs">
											{m.donations_refundedNote({ amount: formatCents(gift.refundedCents) })}
										</div>
									{:else if gift.netCents !== undefined}
										<!-- What the org actually received. The gap between
										     this and the charge is Stripe's fee, and a
										     finance person reconciling a bank deposit needs
										     the net, not the gross. -->
										<div class="text-muted-foreground text-xs">
											{m.donations_netNote({ net: formatCents(gift.netCents) })}
										</div>
									{/if}
								</Table.Cell>
								<Table.Cell>
									<Badge variant={STATUS_VARIANTS[gift.status] ?? 'secondary'}>
										{STATUS_LABELS[gift.status]?.() ?? gift.status}
									</Badge>
								</Table.Cell>
								<Table.Cell class="text-right">
									{#if refundable(gift)}
										<!-- The UI gate is a courtesy; the action re-checks
										     money:write against this gift's own campaign. -->
										<Can do="money:write" campaignId={gift.campaignId}>
											<Button variant="ghost" size="sm" onclick={() => startRefund(gift)}>
												{m.donations_refundAction()}
											</Button>
										</Can>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>

			{#if gifts.status === 'CanLoadMore' || gifts.status === 'LoadingMore'}
				<div class="mt-4 flex justify-center">
					<Button
						variant="outline"
						onclick={() => gifts.loadMore(25)}
						loading={gifts.status === 'LoadingMore'}
						disabled={gifts.status === 'LoadingMore'}
					>
						{m.donations_loadMore()}
					</Button>
				</div>
			{/if}
		{/if}
	</Card.Content>
</Card.Root>

<RefundDialog bind:open={refundOpen} gift={refundTarget} />
