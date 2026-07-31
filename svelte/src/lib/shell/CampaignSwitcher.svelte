<script lang="ts">
	import { createListCollection } from '@ark-ui/svelte/select';
	import * as Select from '$lib/primitives/ui/select';
	import * as m from '$lib/i18n/messages';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';

	let { class: className }: { class?: string } = $props();

	const active = getActiveCampaignContext();

	const collection = $derived(
		createListCollection({
			items: active.campaigns.map((campaign) => ({
				value: campaign._id,
				label: campaign.name
			}))
		})
	);
</script>

{#if active.campaigns.length > 0}
	<Select.Root
		{collection}
		value={active.id ? [active.id] : []}
		onValueChange={(details: { value: string[] }): void => {
			const next = details.value[0];
			if (next) active.select(next);
		}}
		class={className}
	>
		<Select.Label class="sr-only">{m.shell_campaign()}</Select.Label>
		<Select.Trigger size="sm" placeholder={m.shell_selectCampaign()} class="w-full" />
		<Select.Content>
			{#each collection.items as option (option.value)}
				<Select.Item item={option}>
					<Select.ItemText>{option.label}</Select.ItemText>
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
{:else}
	<p class="text-muted-foreground px-2 py-1.5 text-sm">{m.shell_noCampaigns()}</p>
{/if}
