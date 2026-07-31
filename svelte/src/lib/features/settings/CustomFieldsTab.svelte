<script lang="ts">
	import * as Tabs from '$lib/primitives/ui/tabs';
	import type { Id } from '$convex/_generated/dataModel';

	import CustomFieldsPanel from './CustomFieldsPanel.svelte';
	import { fieldEntityLabel } from './labels';
	import type { FieldEntity } from '$lib/domain/field-definitions';

	let { campaignId }: { campaignId: Id<'campaigns'> } = $props();

	const ENTITIES: FieldEntity[] = ['contact', 'project', 'campaign'];
</script>

<Tabs.Root value="contact" class="gap-4">
	<Tabs.List>
		{#each ENTITIES as entity (entity)}
			<Tabs.Trigger value={entity}>{fieldEntityLabel(entity)}</Tabs.Trigger>
		{/each}
	</Tabs.List>

	{#each ENTITIES as entity (entity)}
		<Tabs.Content value={entity}>
			<CustomFieldsPanel {entity} {campaignId} />
		</Tabs.Content>
	{/each}
</Tabs.Root>
