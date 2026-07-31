<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Alert from '$lib/primitives/ui/alert';
	import * as Select from '$lib/primitives/ui/select';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Switch } from '$lib/primitives/ui/switch';
	import { createListCollection } from '@ark-ui/svelte/select';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import InfoIcon from '@lucide/svelte/icons/info';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import type { TaskTemplateItem } from './types';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const client = useConvexClient();

	let { open = $bindable(false), campaignId }: { open?: boolean; campaignId: Id<'campaigns'> } =
		$props();

	type ImpactTag = TaskTemplateItem['impactTag'];
	type Row = { id: number; key: string; label: string; impactTag: ImpactTag };

	let nextRowId = 0;
	let version = $state('');
	let effectiveFrom = $state('');
	let activate = $state(false);
	let rows = $state<Row[]>([]);
	let isSaving = $state(false);

	const impactCollection = createListCollection({
		items: [
			{ value: 'none', label: m.settings_impactTag_none() },
			{ value: 'business', label: m.settings_impactTag_business() },
			{ value: 'school', label: m.settings_impactTag_school() }
		]
	});

	function blankRow(): Row {
		nextRowId += 1;
		return { id: nextRowId, key: '', label: '', impactTag: null };
	}

	$effect(() => {
		if (!open) return;
		version = '';
		effectiveFrom = '';
		activate = false;
		rows = [blankRow()];
	});

	const filled = $derived(rows.filter((row) => row.key.trim() !== '' || row.label.trim() !== ''));

	const rowsComplete = $derived(
		filled.every((row) => row.key.trim() !== '' && row.label.trim() !== '')
	);

	const duplicateKeys = $derived.by(() => {
		const keys = filled.map((row) => row.key.trim()).filter((key) => key !== '');
		return keys.filter((key, index) => keys.indexOf(key) !== index);
	});

	const canSubmit = $derived(
		version.trim().length > 0 && filled.length > 0 && rowsComplete && duplicateKeys.length === 0
	);

	function addRow(): void {
		rows = [...rows, blankRow()];
	}

	function removeRow(id: number): void {
		rows = rows.filter((row) => row.id !== id);
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;

		isSaving = true;
		try {
			await client.mutation(api.taskTemplates.mutations.createTaskTemplateVersion, {
				campaignId,
				version: version.trim(),
				items: filled.map((row, index) => ({
					key: row.key.trim(),
					label: row.label.trim(),
					order: index,
					impactTag: row.impactTag
				})),
				effectiveFrom: effectiveFrom.trim() || undefined,
				activate
			});
			toast.success(m.settings_taskCreated());
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
	<Dialog.Content class="md:max-w-2xl">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.settings_versionNew()}</Dialog.Title>
		</Dialog.Header>

		<Alert.Root class="w-full">
			<InfoIcon class="size-4" />
			<Alert.Description>{m.settings_appendOnlyNote()}</Alert.Description>
		</Alert.Root>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="task-version">{m.settings_version()}</Label>
					<Input id="task-version" bind:value={version} placeholder="2026.1" required />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="task-effective-from">{m.settings_effectiveFrom()}</Label>
					<Input id="task-effective-from" type="date" bind:value={effectiveFrom} />
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<Label>{m.nav_tasks()}</Label>

				<div class="flex flex-col gap-2">
					{#each rows as row (row.id)}
						<div class="flex items-center gap-2">
							<Input
								bind:value={row.key}
								class="max-w-44 font-mono"
								placeholder={m.settings_taskItemKey()}
								aria-label={m.settings_taskItemKey()}
								aria-invalid={duplicateKeys.includes(row.key.trim()) || undefined}
							/>
							<Input
								bind:value={row.label}
								placeholder={m.settings_taskItemLabel()}
								aria-label={m.settings_taskItemLabel()}
							/>
							<Select.Root
								collection={impactCollection}
								value={[row.impactTag ?? 'none']}
								onValueChange={(details: { value: string[] }): void => {
									const next = details.value[0];
									if (next) row.impactTag = next === 'none' ? null : (next as ImpactTag);
								}}
							>
								<Select.Label class="sr-only">{m.settings_impactTag()}</Select.Label>
								<Select.Trigger class="w-36 shrink-0" placeholder={m.settings_impactTag()} />
								<Select.Content>
									{#each impactCollection.items as option (option.value)}
										<Select.Item item={option}>
											<Select.ItemText>{option.label}</Select.ItemText>
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label={m.settings_taskItemRemove()}
								title={m.settings_taskItemRemove()}
								disabled={rows.length === 1}
								onclick={() => removeRow(row.id)}
							>
								<Trash2Icon />
							</Button>
						</div>
					{/each}
				</div>

				<div>
					<Button type="button" variant="outline" size="sm" onclick={addRow}>
						<PlusIcon />
						{m.settings_taskItemAdd()}
					</Button>
				</div>

				{#if duplicateKeys.length > 0}
					<p class="text-error-700-300 text-xs">{m.settings_taskItemKeyDuplicate()}</p>
				{/if}
			</div>

			<Switch bind:checked={activate}>{m.settings_activateOnCreate()}</Switch>

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
