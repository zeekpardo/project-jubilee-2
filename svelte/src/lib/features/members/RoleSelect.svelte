<script lang="ts">
	import { createListCollection } from '@ark-ui/svelte/select';
	import * as Select from '$lib/primitives/ui/select';
	import type { Role } from '$lib/domain/permissions';
	import { roleLabel } from './roles';
	import * as m from '$lib/i18n/messages';

	let {
		value,
		options,
		disabled = false,
		onSelect
	}: {
		value: Role;
		/** Always assignableRoles(callerRole) — never the full role list. */
		options: Role[];
		disabled?: boolean;
		onSelect: (role: Role) => void;
	} = $props();

	const collection = $derived(
		createListCollection({
			items: options.map((role) => ({ value: role, label: roleLabel(role) }))
		})
	);
</script>

<Select.Root
	{collection}
	{disabled}
	value={[value]}
	onValueChange={(details: { value: string[] }): void => {
		const next = details.value[0];
		if (next && next !== value) onSelect(next as Role);
	}}
>
	<Select.Label class="sr-only">{m.members_changeRole()}</Select.Label>
	<Select.Trigger size="sm" placeholder={m.field_role()} class="w-40" />
	<Select.Content>
		{#each collection.items as option (option.value)}
			<Select.Item item={option}>
				<Select.ItemText>{option.label}</Select.ItemText>
			</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
