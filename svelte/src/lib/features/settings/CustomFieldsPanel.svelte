<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import * as Table from '$lib/primitives/ui/table';
	import * as Alert from '$lib/primitives/ui/alert';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import InfoIcon from '@lucide/svelte/icons/info';
	import { toast } from 'svelte-sonner';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import CategoryFormDialog from './CategoryFormDialog.svelte';
	import FieldFormDialog from './FieldFormDialog.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { fieldScopeLabel, fieldTypeLabel } from './labels';
	import type { FieldCategory, FieldDefinitionRow } from './types';
	import type { FieldEntity } from '$lib/domain/field-definitions';
	import * as m from '$lib/i18n/messages';

	let { entity, campaignId }: { entity: FieldEntity; campaignId: Id<'campaigns'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	const categoriesResponse = useQuery(api.customFields.queries.listCategories, () =>
		auth.isAuthenticated ? { entity, campaignId } : 'skip'
	);
	const fieldsResponse = useQuery(api.customFields.queries.listFieldDefinitions, () =>
		auth.isAuthenticated ? { entity, campaignId } : 'skip'
	);

	const categories = $derived((categoriesResponse.data ?? []) as FieldCategory[]);
	const fields = $derived((fieldsResponse.data ?? []) as FieldDefinitionRow[]);
	const isLoading = $derived(categoriesResponse.isLoading || fieldsResponse.isLoading);

	type Group = {
		id: string;
		name: string;
		category: FieldCategory | null;
		fields: FieldDefinitionRow[];
	};

	const groups = $derived.by<Group[]>(() => {
		const result: Group[] = categories.map((category) => ({
			id: category._id as string,
			name: category.name,
			category,
			fields: fields.filter((field) => field.categoryId === category._id)
		}));
		const uncategorized = fields.filter(
			(field) => !categories.some((category) => category._id === field.categoryId)
		);
		if (uncategorized.length > 0) {
			result.push({
				id: 'uncategorized',
				name: m.settings_categoryUncategorized(),
				category: null,
				fields: uncategorized
			});
		}
		return result;
	});

	let categoryFormOpen = $state(false);
	let editingCategory = $state<FieldCategory | null>(null);
	let categoryDeleteOpen = $state(false);
	let deletingCategory = $state<FieldCategory | null>(null);

	let fieldFormOpen = $state(false);
	let editingField = $state<FieldDefinitionRow | null>(null);
	let fieldDeleteOpen = $state(false);
	let deletingField = $state<FieldDefinitionRow | null>(null);

	function openCreateCategory(): void {
		editingCategory = null;
		categoryFormOpen = true;
	}

	function openEditCategory(category: FieldCategory): void {
		editingCategory = category;
		categoryFormOpen = true;
	}

	function openDeleteCategory(category: FieldCategory): void {
		deletingCategory = category;
		categoryDeleteOpen = true;
	}

	function openCreateField(): void {
		editingField = null;
		fieldFormOpen = true;
	}

	function openEditField(field: FieldDefinitionRow): void {
		editingField = field;
		fieldFormOpen = true;
	}

	function openDeleteField(field: FieldDefinitionRow): void {
		deletingField = field;
		fieldDeleteOpen = true;
	}

	async function confirmDeleteCategory(): Promise<void> {
		if (!deletingCategory) return;
		await client.mutation(api.customFields.mutations.deleteCategory, {
			categoryId: deletingCategory._id
		});
		toast.success(m.settings_categoryDeleted());
	}

	async function confirmDeleteField(): Promise<void> {
		if (!deletingField) return;
		await client.mutation(api.customFields.mutations.deleteFieldDefinition, {
			fieldId: deletingField._id
		});
		toast.success(m.settings_fieldDeleted());
	}
</script>

<div class="flex flex-col gap-4">
	<Alert.Root>
		<InfoIcon class="size-4" />
		<Alert.Description>{m.settings_scopeInheritHelp()}</Alert.Description>
	</Alert.Root>

	<div class="flex justify-end gap-2">
		<Button variant="outline" onclick={openCreateCategory}>
			<PlusIcon />
			{m.settings_categoryNew()}
		</Button>
		<Button onclick={openCreateField}>
			<PlusIcon />
			{m.settings_fieldNew()}
		</Button>
	</div>

	{#if isLoading}
		<div class="flex flex-col gap-3">
			<Skeleton class="h-32 w-full" />
			<Skeleton class="h-32 w-full" />
		</div>
	{:else if groups.length === 0}
		<EmptyState title={m.settings_fieldsEmpty()}>
			{#snippet action()}
				<Button onclick={openCreateField}>
					<PlusIcon />
					{m.settings_fieldNew()}
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="flex flex-col gap-4">
			{#each groups as group (group.id)}
				<Card.Root>
					<Card.Header>
						<Card.Title>{group.name}</Card.Title>
						{#if group.category}
							<Card.Description>{fieldScopeLabel(group.category.scope)}</Card.Description>
							<Card.Action>
								<span class="flex items-center gap-1">
									<Button
										variant="ghost"
										size="icon"
										aria-label={m.action_edit()}
										title={m.action_edit()}
										onclick={() => openEditCategory(group.category as FieldCategory)}
									>
										<PencilIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										aria-label={m.action_delete()}
										title={m.action_delete()}
										onclick={() => openDeleteCategory(group.category as FieldCategory)}
									>
										<Trash2Icon />
									</Button>
								</span>
							</Card.Action>
						{/if}
					</Card.Header>
					<Card.Content>
						{#if group.fields.length === 0}
							<EmptyState size="sm" variant="plain" title={m.settings_fieldsEmpty()} />
						{:else}
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head>{m.settings_fieldKey()}</Table.Head>
										<Table.Head>{m.field_name()}</Table.Head>
										<Table.Head>{m.settings_fieldType()}</Table.Head>
										<Table.Head>{m.field_status()}</Table.Head>
										<Table.Head class="text-right">{m.field_actions()}</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each group.fields as field (field._id)}
										<Table.Row>
											<Table.Cell class="text-muted-foreground font-mono text-xs">
												{field.key}
											</Table.Cell>
											<Table.Cell class="font-medium">{field.label}</Table.Cell>
											<Table.Cell>
												<Badge variant="secondary">{fieldTypeLabel(field.type)}</Badge>
											</Table.Cell>
											<Table.Cell>
												<span class="flex flex-wrap gap-1">
													<Badge variant="outline">{fieldScopeLabel(field.scope)}</Badge>
													{#if field.isRequired}
														<Badge variant="secondary">{m.settings_fieldRequired()}</Badge>
													{/if}
													{#if field.isPublic}
														<Badge variant="warning" title={m.settings_fieldPublicWarning()}>
															<GlobeIcon />
															{m.settings_fieldPublic()}
														</Badge>
													{/if}
												</span>
											</Table.Cell>
											<Table.Cell>
												<span class="flex items-center justify-end gap-1">
													<Button
														variant="ghost"
														size="icon"
														aria-label={m.action_edit()}
														title={m.action_edit()}
														onclick={() => openEditField(field)}
													>
														<PencilIcon />
													</Button>
													<Button
														variant="ghost"
														size="icon"
														aria-label={m.action_delete()}
														title={m.action_delete()}
														onclick={() => openDeleteField(field)}
													>
														<Trash2Icon />
													</Button>
												</span>
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						{/if}
					</Card.Content>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>

<CategoryFormDialog bind:open={categoryFormOpen} {entity} {campaignId} category={editingCategory} />

<FieldFormDialog
	bind:open={fieldFormOpen}
	{entity}
	{campaignId}
	{categories}
	field={editingField}
/>

<ConfirmDialog
	bind:open={categoryDeleteOpen}
	title={m.settings_categoryDeleteTitle()}
	body={m.settings_categoryDeleteBody({ name: deletingCategory?.name ?? '' })}
	onConfirm={confirmDeleteCategory}
/>

<ConfirmDialog
	bind:open={fieldDeleteOpen}
	title={m.settings_fieldDeleteTitle()}
	body={m.settings_fieldDeleteBody({ label: deletingField?.label ?? '' })}
	onConfirm={confirmDeleteField}
/>
