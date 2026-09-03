<script lang="ts">
	// Creating a workflow asks for the two things it cannot be created without:
	// a campaign and a name. Everything else — steps, report, prompts — is
	// seeded server-side from the shipped defaults, so the author lands in an
	// editor with a starting point rather than four empty tabs.
	//
	// The campaign is a FIELD, not a parent: workflows do not live inside a
	// campaign, which is what makes "duplicate this to another campaign"
	// possible later without moving anything.

	// Shell
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import type { Id } from '$convex/_generated/dataModel';
	import type { CampaignOption } from './types';
	import * as m from '$lib/i18n/messages';

	let {
		open = $bindable(false),
		campaigns
	}: {
		open?: boolean;
		campaigns: CampaignOption[];
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let name = $state('');
	let campaignId = $state<Id<'campaigns'> | null>(null);
	let isSaving = $state(false);

	$effect(() => {
		if (!open) return;
		name = '';
		// One campaign is the common case and picking it for the author is not a
		// guess. More than one and the box stays empty rather than defaulting to
		// whichever came back first.
		campaignId = campaigns.length === 1 ? campaigns[0]._id : null;
	});

	const campaignCollection = $derived(
		createListCollection({
			items: campaigns.map((campaign) => ({ value: campaign._id, label: campaign.name }))
		})
	);

	const canSubmit = $derived(name.trim() !== '' && campaignId !== null);

	async function handleCreate(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit || !campaignId) return;
		isSaving = true;
		try {
			const workflowId = await client.mutation(api.workflows.mutations.createWorkflow, {
				campaignId,
				name: name.trim()
			});
			open = false;
			// Straight into the editor: a workflow with nothing authored in it is
			// not a thing anyone wants to look at in a list.
			await goto(resolve('/app/admin/workflows/[id]', { id: workflowId }));
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-lg">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.workflows_newTitle()}</Dialog.Title>
			<Dialog.Description>{m.workflows_newBody()}</Dialog.Description>
		</Dialog.Header>

		<form class="flex w-full flex-col gap-4" onsubmit={handleCreate}>
			<div class="flex flex-col gap-2">
				<Label for="new-workflow-name">{m.field_name()}</Label>
				<Input id="new-workflow-name" bind:value={name} required autocomplete="off" />
			</div>

			<div class="flex flex-col gap-2">
				<Label for="new-workflow-campaign">{m.workflows_campaign()}</Label>
				<Select.Root
					triggerId="new-workflow-campaign"
					collection={campaignCollection}
					value={campaignId ? [campaignId] : []}
					onValueChange={(details: { value: string[] }): void => {
						// The collection is built from campaign ids, so anything that
						// comes back is one — the assertion is the select's string API
						// meeting a branded id, not a guess about the value.
						const next = details.value[0];
						if (next) campaignId = next as Id<'campaigns'>;
					}}
				>
					<Select.Trigger class="w-full" placeholder={m.workflows_campaignPlaceholder()} />
					<Select.Content>
						{#each campaignCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<Dialog.Footer class="w-full">
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || !canSubmit}>
					{m.action_create()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
