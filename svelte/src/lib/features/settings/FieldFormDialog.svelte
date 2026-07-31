<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import * as Alert from '$lib/primitives/ui/alert';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Switch } from '$lib/primitives/ui/switch';
	import { Checkbox } from '$lib/primitives/ui/checkbox';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { createListCollection } from '@ark-ui/svelte/select';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import { fieldTypeLabel } from './labels';
	import type { FieldCategory, FieldDefinitionRow } from './types';
	import { FIELD_TYPES } from '$lib/domain/field-definitions';
	import type { FieldEntity, FieldScope, FieldType } from '$lib/domain/field-definitions';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const client = useConvexClient();

	const UNCATEGORIZED = '__none__';

	let {
		open = $bindable(false),
		entity,
		campaignId,
		categories,
		field = null
	}: {
		open?: boolean;
		entity: FieldEntity;
		campaignId: Id<'campaigns'>;
		categories: FieldCategory[];
		/** Null creates, a definition edits. */
		field?: FieldDefinitionRow | null;
	} = $props();

	let key = $state('');
	let label = $state('');
	let scope = $state<FieldScope>('org');
	let type = $state<FieldType>('text');
	let optionsText = $state('');
	let order = $state('0');
	let categoryId = $state<string>(UNCATEGORIZED);
	let isRequired = $state(false);
	let isPublic = $state(false);
	let wasPublic = $state(false);
	let publicAcknowledged = $state(false);
	let isSaving = $state(false);

	const isEdit = $derived(field !== null);

	// A contact belongs to the org, not to a campaign, so a campaign-scope
	// contact field could never hold a value — setRecordAttributes resolves
	// contact fields with no campaign and would reject one as unknown.
	const scopeCollection = $derived(
		createListCollection({
			items:
				entity === 'contact'
					? [{ value: 'org', label: m.settings_scope_org() }]
					: [
							{ value: 'org', label: m.settings_scope_org() },
							{ value: 'campaign', label: m.settings_scope_campaign() }
						]
		})
	);

	const typeCollection = createListCollection({
		items: FIELD_TYPES.map((value) => ({ value, label: fieldTypeLabel(value) }))
	});

	// A category may only hold fields it applies to: an org-scope field can never
	// sit in a category that belongs to one campaign.
	const availableCategories = $derived(
		categories.filter((category) => scope === 'campaign' || category.scope === 'org')
	);

	const categoryCollection = $derived(
		createListCollection({
			items: [
				{ value: UNCATEGORIZED, label: m.settings_categoryUncategorized() },
				...availableCategories.map((category) => ({
					value: category._id as string,
					label: category.name
				}))
			]
		})
	);

	$effect(() => {
		if (!open) return;
		const source = field;
		key = source?.key ?? '';
		label = source?.label ?? '';
		scope = source?.scope ?? 'org';
		type = source?.type ?? 'text';
		optionsText = (source?.options ?? []).join('\n');
		order = String(source?.order ?? 0);
		categoryId = source?.categoryId ?? UNCATEGORIZED;
		isRequired = source?.isRequired ?? false;
		isPublic = source?.isPublic ?? false;
		wasPublic = source?.isPublic ?? false;
		publicAcknowledged = false;
	});

	const options = $derived(
		optionsText
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line !== '')
	);

	/** Turning a field public exposes every value already stored in it. */
	const needsPublicConfirm = $derived(isPublic && !wasPublic);

	const canSubmit = $derived(
		label.trim().length > 0 &&
			(isEdit || key.trim().length > 0) &&
			(type !== 'select' || options.length > 0) &&
			(!needsPublicConfirm || publicAcknowledged)
	);

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;

		const parsedOrder = Number.parseInt(order, 10);
		const resolvedOrder = Number.isFinite(parsedOrder) ? parsedOrder : 0;
		// An empty list rather than omitting the arg: on edit the server falls back to
		// the stored options, which would fail its own shape check once the type has
		// been changed away from 'select'.
		const resolvedOptions = type === 'select' ? options : [];

		try {
			if (field) {
				await client.mutation(api.customFields.mutations.updateFieldDefinition, {
					fieldId: field._id,
					categoryId:
						categoryId === UNCATEGORIZED ? null : (categoryId as Id<'customFieldCategories'>),
					label: label.trim(),
					type,
					options: resolvedOptions,
					order: resolvedOrder,
					isRequired,
					isPublic
				});
			} else {
				await client.mutation(api.customFields.mutations.createFieldDefinition, {
					entity,
					scope,
					campaignId: scope === 'campaign' ? campaignId : undefined,
					categoryId:
						categoryId === UNCATEGORIZED ? undefined : (categoryId as Id<'customFieldCategories'>),
					key: key.trim(),
					label: label.trim(),
					type,
					options: resolvedOptions,
					order: resolvedOrder,
					isRequired,
					isPublic
				});
			}
			toast.success(m.settings_fieldSaved());
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
	<Dialog.Content class="md:max-w-xl">
		<Dialog.Header class="w-full">
			<Dialog.Title>{isEdit ? m.settings_fieldEdit() : m.settings_fieldNew()}</Dialog.Title>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<div class="flex flex-col gap-2">
				<Label for="field-label">{m.field_name()}</Label>
				<Input id="field-label" bind:value={label} required />
			</div>

			{#if !isEdit}
				<div class="flex flex-col gap-2">
					<Label for="field-key">{m.settings_fieldKey()}</Label>
					<Input id="field-key" bind:value={key} class="font-mono" required />
					<p class="text-muted-foreground text-xs">{m.settings_fieldKeyHelp()}</p>
				</div>

				<div class="flex flex-col gap-2">
					<Label>{m.settings_scope_org()}</Label>
					<Select.Root
						collection={scopeCollection}
						value={[scope]}
						onValueChange={(details: { value: string[] }): void => {
							const next = details.value[0];
							if (next) {
								scope = next as FieldScope;
								// An org-scope field cannot keep a campaign category.
								if (scope === 'org') categoryId = UNCATEGORIZED;
							}
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

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label>{m.settings_fieldType()}</Label>
					<Select.Root
						collection={typeCollection}
						value={[type]}
						onValueChange={(details: { value: string[] }): void => {
							const next = details.value[0];
							if (next) type = next as FieldType;
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.settings_fieldType()} />
						<Select.Content>
							{#each typeCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="flex flex-col gap-2">
					<Label for="field-order">{m.settings_stageOrder()}</Label>
					<Input id="field-order" type="number" bind:value={order} />
				</div>
			</div>

			{#if type === 'select'}
				<div class="flex flex-col gap-2">
					<Label for="field-options">{m.settings_fieldOptions()}</Label>
					<Textarea id="field-options" bind:value={optionsText} rows={4} />
					<p class="text-muted-foreground text-xs">{m.settings_fieldOptionsHelp()}</p>
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<Label>{m.settings_category()}</Label>
				<Select.Root
					collection={categoryCollection}
					value={[categoryId]}
					onValueChange={(details: { value: string[] }): void => {
						const next = details.value[0];
						if (next) categoryId = next;
					}}
				>
					<Select.Trigger class="w-full" placeholder={m.settings_categoryUncategorized()} />
					<Select.Content>
						{#each categoryCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<Switch bind:checked={isRequired}>{m.settings_fieldRequired()}</Switch>

			<div class="flex flex-col gap-2">
				<Switch bind:checked={isPublic}>{m.settings_fieldPublic()}</Switch>
				<p class="text-muted-foreground text-xs">{m.settings_fieldPublicWarning()}</p>
			</div>

			{#if needsPublicConfirm}
				<Alert.Root variant="warning" class="w-full">
					<TriangleAlertIcon class="size-4" />
					<Alert.Title>{m.settings_fieldPublicConfirmTitle()}</Alert.Title>
					<Alert.Description>
						<span class="flex flex-col gap-2">
							<span>{m.settings_fieldPublicConfirmBody()}</span>
							<Checkbox
								checked={publicAcknowledged}
								onCheckedChange={(details) => (publicAcknowledged = details.checked === true)}
							>
								{m.action_confirm()}
							</Checkbox>
						</span>
					</Alert.Description>
				</Alert.Root>
			{/if}

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
