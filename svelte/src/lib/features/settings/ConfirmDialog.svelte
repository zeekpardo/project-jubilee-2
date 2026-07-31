<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Alert from '$lib/primitives/ui/alert';
	import { Button } from '$lib/primitives/ui/button';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	import { ConvexError } from 'convex/values';
	import * as m from '$lib/i18n/messages';

	let {
		open = $bindable(false),
		title,
		body,
		confirmLabel = m.action_delete(),
		onConfirm
	}: {
		open?: boolean;
		title: string;
		body: string;
		confirmLabel?: string;
		onConfirm: () => Promise<unknown>;
	} = $props();

	let isWorking = $state(false);
	let failure = $state<string | null>(null);

	$effect(() => {
		if (!open) failure = null;
	});

	async function handleConfirm(): Promise<void> {
		if (isWorking) return;
		isWorking = true;
		failure = null;
		try {
			await onConfirm();
			open = false;
		} catch (error: unknown) {
			// The server refuses some deletes on rules the UI cannot see (a stage
			// still holding records); keep the dialog open so the reason is read.
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
			<Dialog.Title>{title}</Dialog.Title>
		</Dialog.Header>

		<Alert.Root variant="destructive" class="w-full">
			<TriangleAlertIcon class="size-4" />
			<Alert.Description>{body}</Alert.Description>
		</Alert.Root>

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
				{confirmLabel}
			</Button>
		</Dialog.Footer>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
