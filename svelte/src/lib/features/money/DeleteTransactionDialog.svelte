<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Alert from '$lib/primitives/ui/alert';
	import { Button } from '$lib/primitives/ui/button';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import { formatCents } from './format';
	import type { Transaction } from './types';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const client = useConvexClient();

	let {
		open = $bindable(false),
		transaction
	}: {
		open?: boolean;
		transaction: Transaction | null;
	} = $props();

	let isWorking = $state(false);
	let failure = $state<string | null>(null);

	$effect(() => {
		if (!open) failure = null;
	});

	async function handleConfirm(): Promise<void> {
		if (isWorking || !transaction) return;
		isWorking = true;
		failure = null;
		try {
			await client.mutation(api.transactions.mutations.deleteTransaction, {
				transactionId: transaction._id
			});
			open = false;
		} catch (error: unknown) {
			failure =
				error instanceof ConvexError
					? String(error.data)
					: error instanceof Error
						? error.message
						: m.state_error();
		} finally {
			isWorking = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-lg">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.money_deleteTransaction()}</Dialog.Title>
		</Dialog.Header>

		<Alert.Root variant="destructive" class="w-full">
			<TriangleAlertIcon class="size-4" />
			<Alert.Description>{m.money_deleteTransactionBody()}</Alert.Description>
		</Alert.Root>

		{#if transaction}
			<p class="text-muted-foreground w-full text-sm tabular-nums">
				{formatCents(transaction.amountCents)}
				{#if transaction.occurredOn}
					· {transaction.occurredOn}
				{/if}
			</p>
		{/if}

		{#if failure}
			<Alert.Root variant="warning" class="w-full">
				<TriangleAlertIcon class="size-4" />
				<Alert.Title>{m.state_error()}</Alert.Title>
				<Alert.Description>{failure}</Alert.Description>
			</Alert.Root>
		{/if}

		<Dialog.Footer class="w-full">
			<Button variant="outline" onclick={() => (open = false)} disabled={isWorking}>
				{m.action_cancel()}
			</Button>
			<Button
				variant="destructive"
				loading={isWorking}
				disabled={isWorking}
				onclick={handleConfirm}
			>
				{m.action_delete()}
			</Button>
		</Dialog.Footer>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
