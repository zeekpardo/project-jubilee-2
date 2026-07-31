<script lang="ts">
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

	import type { FieldCategory } from './types';
	import type { FieldEntity, FieldScope } from '$lib/domain/field-definitions';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const client = useConvexClient();

	let {
		open = $bindable(false),
		entity,
		campaignId,
		category = null
	}: {
		open?: boolean;
		entity: FieldEntity;
		campaignId: Id<'campaigns'>;
		/** Null creates, a category edits. */
		category?: FieldCategory | null;
	} = $props();

	let name = $state('');
	let order = $state('0');
	let scope = $state<FieldScope>('org');
	let isSaving = $state(false);

	const isEdit = $derived(category !== null);

	const scopeCollection = createListCollection({
		items: [
			{ value: 'org', label: m.settings_scope_org() },
			{ value: 'campaign', label: m.settings_scope_campaign() }
		]
	});

	$effect(() => {
		if (!open) return;
		const source = category;
		name = source?.name ?? '';
		order = String(source?.order ?? 0);
		scope = source?.scope ?? 'org';
	});

	const canSubmit = $derived(name.trim().length > 0);

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;

		const parsedOrder = Number.parseInt(order, 10);

		try {
			if (category) {
				await client.mutation(api.customFields.mutations.updateCategory, {
					categoryId: category._id,
					name: name.trim(),
					order: Number.isFinite(parsedOrder) ? parsedOrder : 0
				});
			} else {
				await client.mutation(api.customFields.mutations.createCategory, {
					entity,
					scope,
					campaignId: scope === 'campaign' ? campaignId : undefined,
					name: name.trim(),
					order: Number.isFinite(parsedOrder) ? parsedOrder : 0
				});
			}
			toast.success(m.settings_categorySaved());
			open = false;
		} catch (error: unknown) {
			toast.error(
				error instanceof ConvexError
					? String(error.data)
					: error instanceof Error
						? error.message
						: m.state_saveFailed()
			);
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-lg">
		<Dialog.Header class="w-full">
			<Dialog.Title>{isEdit ? m.settings_categoryEdit() : m.settings_categoryNew()}</Dialog.Title>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<div class="flex flex-col gap-2">
				<Label for="category-name">{m.field_name()}</Label>
				<Input id="category-name" bind:value={name} required />
			</div>

			{#if !isEdit}
				<div class="flex flex-col gap-2">
					<Label>{m.settings_scope_org()}</Label>
					<Select.Root
						collection={scopeCollection}
						value={[scope]}
						onValueChange={(details: { value: string[] }): void => {
							const next = details.value[0];
							if (next) scope = next as FieldScope;
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.settings_scope_org()} />
						<Select.Content>
							{#each scopeCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<p class="text-muted-foreground text-xs">{m.settings_scopeInheritHelp()}</p>
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<Label for="category-order">{m.settings_stageOrder()}</Label>
				<Input id="category-order" type="number" bind:value={order} />
			</div>

			<Dialog.Footer class="w-full">
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || !canSubmit}>
					{isEdit ? m.action_save() : m.action_create()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
