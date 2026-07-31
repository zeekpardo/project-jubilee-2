<script lang="ts">
	import { createListCollection } from '@ark-ui/svelte/select';
	import * as Select from '$lib/primitives/ui/select';
	import * as m from '$lib/i18n/messages';
	import { THEMES, type Theme } from './config';
	import { themeState } from './state.svelte';

	let { class: className }: { class?: string } = $props();

	const collection = createListCollection({ items: THEMES.map((theme) => ({ ...theme })) });
</script>

<Select.Root
	{collection}
	value={[themeState.theme]}
	onValueChange={(details: { value: string[] }): void => {
		const next = details.value[0];
		if (next) themeState.setTheme(next as Theme);
	}}
	class={className}
>
	<Select.Label class="sr-only">{m.theme_label()}</Select.Label>
	<Select.Trigger size="sm" placeholder={m.theme_selectPlaceholder()} class="w-36" />
	<Select.Content>
		{#each collection.items as option (option.value)}
			<Select.Item item={option}>
				<Select.ItemText>{option.label}</Select.ItemText>
			</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
