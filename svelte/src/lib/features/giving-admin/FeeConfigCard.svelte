<script lang="ts">
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { formatCents } from '$lib/features/money/format';
	import * as m from '$lib/i18n/messages';
	import type { ConnectAccount } from './types';

	let { account }: { account: ConnectAccount } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	// Entered as a percentage because that is how Stripe quotes it and how an
	// org will read it off their agreement. Stored as a fraction, because that
	// is what the gross-up formula divides by.
	let ratePercent = $state('');
	let feeFixedCents = $state('');
	let isSaving = $state(false);

	let loaded = $state(false);
	$effect(() => {
		if (loaded) return;
		ratePercent = (account.feeRate * 100).toFixed(2);
		feeFixedCents = String(account.feeFixedCents);
		loaded = true;
	});

	// Shown live so the person typing sees the consequence of the number rather
	// than the number. A rate entered as 2.9 instead of 0.029 is caught by
	// eye here long before it reaches a donor.
	const preview = $derived.by(() => {
		const rate = Number(ratePercent) / 100;
		const fixed = Number(feeFixedCents);
		if (!Number.isFinite(rate) || !Number.isFinite(fixed) || rate < 0 || rate >= 1) return null;
		return Math.ceil((10000 + fixed) / (1 - rate));
	});

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving) return;
		isSaving = true;
		try {
			await client.action(api.stripe.accounts.setFeeConfig, {
				feeRate: Number(ratePercent) / 100,
				feeFixedCents: Math.round(Number(feeFixedCents))
			});
			toast.success(m.giving_feeSaved());
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.giving_feesTitle()}</Card.Title>
		<Card.Description>{m.giving_feesBody()}</Card.Description>
	</Card.Header>
	<Card.Content>
		<form class="flex flex-col gap-4" onsubmit={save}>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="giving-fee-rate">{m.giving_feeRateLabel()}</Label>
					<Input
						id="giving-fee-rate"
						type="number"
						min={0}
						max={10}
						step="0.01"
						inputmode="decimal"
						bind:value={ratePercent}
					/>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="giving-fee-fixed">{m.giving_feeFixedLabel()}</Label>
					<Input
						id="giving-fee-fixed"
						type="number"
						min={0}
						max={500}
						step="1"
						inputmode="numeric"
						bind:value={feeFixedCents}
					/>
				</div>
			</div>

			{#if preview !== null}
				<p class="text-muted-foreground text-sm tabular-nums">
					{formatCents(10000)} → {formatCents(preview)}
				</p>
			{/if}

			<div>
				<Button type="submit" loading={isSaving} disabled={isSaving}>
					{m.giving_feeSave()}
				</Button>
			</div>
		</form>
	</Card.Content>
</Card.Root>
