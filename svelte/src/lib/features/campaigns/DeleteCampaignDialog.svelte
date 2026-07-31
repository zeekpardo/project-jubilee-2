<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import { Button } from '$lib/primitives/ui/button';
	import * as Alert from '$lib/primitives/ui/alert';
	import { toast } from 'svelte-sonner';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import type { Campaign } from './types';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const client = useConvexClient();

	let {
		open = $bindable(false),
		campaign
	}: {
		open?: boolean;
		campaign: Campaign | null;
	} = $props();

	let isDeleting = $state(false);

	async function handleDelete(): Promise<void> {
		if (!campaign || isDeleting) return;
		isDeleting = true;
		try {
			await client.mutation(api.campaigns.mutations.deleteCampaign, {
				campaignId: campaign._id
			});
			toast.success(m.campaigns_deleted());
			open = false;
		} catch (error: unknown) {
			toast.error(error instanceof Error ? error.message : m.state_error());
		} finally {
			isDeleting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-lg">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.campaigns_deleteTitle()}</Dialog.Title>
		</Dialog.Header>

		<Alert.Root variant="destructive" class="w-full">
			<TriangleAlertIcon class="size-4" />
			<Alert.Description>
				{m.campaigns_deleteBody({ name: campaign?.name ?? '' })}
			</Alert.Description>
		</Alert.Root>

		<Dialog.Footer class="w-full">
			<Button variant="outline" onclick={() => (open = false)} disabled={isDeleting}>
				{m.action_cancel()}
			</Button>
			<Button
				variant="destructive"
				loading={isDeleting}
				disabled={isDeleting}
				onclick={handleDelete}
			>
				{m.action_delete()}
			</Button>
		</Dialog.Footer>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
