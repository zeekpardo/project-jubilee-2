<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Alert from '$lib/primitives/ui/alert';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { ConvexError } from 'convex/values';
	import { toast } from 'svelte-sonner';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import { formatCents } from '$lib/features/money/format';
	import * as m from '$lib/i18n/messages';
	import type { OnlineGift } from './types';

	const { api } = getAuthContext();
	const client = useConvexClient();

	let {
		open = $bindable(false),
		gift
	}: {
		open?: boolean;
		gift: OnlineGift | null;
	} = $props();

	const refundableCents = $derived(gift ? gift.chargedCents - gift.refundedCents : 0);

	// Dollars in the field, cents everywhere else. `formatCents` is the only
	// place money becomes text elsewhere in this app; this is the inverse and
	// is deliberately the only one.
	let amountDollars = $state('');
	let reason = $state<'requested_by_customer' | 'duplicate' | 'fraudulent'>(
		'requested_by_customer'
	);
	let isWorking = $state(false);
	let failure = $state<string | null>(null);

	// Reseeded each time the dialog opens rather than on every gift change, so
	// a live-updating table underneath cannot rewrite an amount being typed.
	$effect(() => {
		if (!open) {
			failure = null;
			return;
		}
		amountDollars = (refundableCents / 100).toFixed(2);
		reason = 'requested_by_customer';
	});

	const amountCents = $derived(Math.round(Number(amountDollars) * 100));
	const amountValid = $derived(
		Number.isInteger(amountCents) && amountCents > 0 && amountCents <= refundableCents
	);

	async function confirm(): Promise<void> {
		if (isWorking || !gift || !amountValid) return;
		isWorking = true;
		failure = null;
		try {
			await client.action(api.stripe.refunds.refundGift, {
				donationIntentId: gift._id,
				amountCents,
				reason
			});
			// "Sent to Stripe", not "refunded". The ledger row changes when the
			// `charge.refunded` webhook lands, which is a beat later — and
			// claiming otherwise would have the table disagree with the toast.
			toast.success(m.donations_refundQueued());
			open = false;
		} catch (error) {
			failure = error instanceof ConvexError ? String(error.data) : m.state_saveFailed();
		} finally {
			isWorking = false;
		}
	}

	const REASONS = [
		{ value: 'requested_by_customer', label: m.donations_refundReason_requested_by_customer },
		{ value: 'duplicate', label: m.donations_refundReason_duplicate },
		{ value: 'fraudulent', label: m.donations_refundReason_fraudulent }
	] as const;
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.donations_refundTitle()}</Dialog.Title>
			<Dialog.Description>{m.donations_refundBody()}</Dialog.Description>
		</Dialog.Header>

		{#if gift}
			<div class="flex flex-col gap-4">
				<div class="flex flex-col gap-1.5">
					<Label for="refund-amount">{m.donations_refundAmountLabel()}</Label>
					<Input
						id="refund-amount"
						type="number"
						min="0.01"
						max={(refundableCents / 100).toFixed(2)}
						step="0.01"
						inputmode="decimal"
						bind:value={amountDollars}
					/>
					<p class="text-muted-foreground text-xs">
						{m.donations_refundFullHint({ amount: formatCents(refundableCents) })}
					</p>
				</div>

				<div class="flex flex-col gap-1.5">
					<Label for="refund-reason">{m.donations_refundReasonLabel()}</Label>
					<div class="flex flex-wrap gap-2">
						{#each REASONS as option (option.value)}
							<button
								type="button"
								onclick={() => (reason = option.value)}
								aria-pressed={reason === option.value}
								class="ring-border hover:bg-muted/60 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:ring-primary rounded-lg px-3 py-1.5 text-sm ring-1 transition-colors"
							>
								{option.label()}
							</button>
						{/each}
					</div>
				</div>

				{#if gift.acknowledgedAt}
					<!-- Worth stating outright: the donor already holds a receipt
					     asserting a deduction they are about to lose part or all of,
					     and correcting it is not optional. -->
					<p class="text-muted-foreground text-sm">{m.donations_receiptVoidWarning()}</p>
				{/if}

				{#if failure}
					<Alert.Root variant="destructive">
						<TriangleAlertIcon class="size-4" aria-hidden="true" />
						<Alert.Description>{failure}</Alert.Description>
					</Alert.Root>
				{/if}
			</div>

			<Dialog.Footer>
				<Button variant="outline" onclick={() => (open = false)} disabled={isWorking}>
					{m.action_cancel()}
				</Button>
				<Button
					variant="destructive"
					onclick={confirm}
					loading={isWorking}
					disabled={isWorking || !amountValid}
				>
					{m.donations_refundConfirm({
						amount: formatCents(amountValid ? amountCents : 0)
					})}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
