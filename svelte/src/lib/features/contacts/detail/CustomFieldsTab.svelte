<script lang="ts">
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';
	import { createListCollection } from '@ark-ui/svelte/select';

	import * as Card from '$lib/primitives/ui/card';
	import * as Select from '$lib/primitives/ui/select';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Switch } from '$lib/primitives/ui/switch';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import type { SwitchCheckedChangeDetails } from '$lib/primitives/ui/switch';
	import EyeIcon from '@lucide/svelte/icons/eye';

	import { getAccessContext } from '$lib/access';
	import {
		attributeValue,
		coerceFieldValue,
		missingRequiredFields,
		type FieldDefinition
	} from '$lib/domain/field-definitions';
	import { centsToDollarInput, dollarsToCents } from '$lib/features/settings/amount';
	import * as m from '$lib/i18n/messages';

	import type { Id } from '$convex/_generated/dataModel';

	let {
		contactId,
		campaignId = null
	}: { contactId: Id<'contacts'>; campaignId?: Id<'campaigns'> | null } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();
	const access = getAccessContext();

	const canWrite = $derived(access.can('contacts:write', campaignId));

	const contactResponse = useQuery(api.contacts.queries.getContact, () =>
		auth.isAuthenticated ? { contactId } : 'skip'
	);
	const contact = $derived(contactResponse.data ?? null);

	// A contact belongs to the org, not to any one campaign, so with no
	// campaignId (the admin record) only org-scope contact fields apply. Pass
	// one from a campaign-scoped page and that campaign's own fields join in —
	// see resolveFieldDefinitions, which those get resolved from.
	const fieldsResponse = useQuery(api.customFields.queries.resolveFields, () =>
		auth.isAuthenticated
			? { entity: 'contact' as const, campaignId: campaignId ?? undefined }
			: 'skip'
	);
	const fields = $derived(fieldsResponse.data ?? []);

	const categoriesResponse = useQuery(api.customFields.queries.listCategories, () =>
		auth.isAuthenticated
			? { entity: 'contact' as const, campaignId: campaignId ?? undefined }
			: 'skip'
	);
	const categories = $derived(categoriesResponse.data ?? []);

	const loading = $derived(
		contactResponse.isLoading || fieldsResponse.isLoading || categoriesResponse.isLoading
	);

	const groups = $derived.by(() => {
		const byCategory: Record<string, FieldDefinition[]> = {};
		for (const def of fields) {
			// A field whose category row was deleted falls in with the uncategorized
			// ones rather than vanishing from the form.
			const known = categories.some((category) => category._id === def.categoryId);
			const bucket = known && def.categoryId ? def.categoryId : '';
			(byCategory[bucket] ??= []).push(def);
		}

		const ordered: { id: string; name: string | null; fields: FieldDefinition[] }[] = [];
		for (const category of categories) {
			const members = byCategory[category._id];
			if (members) ordered.push({ id: category._id, name: category.name, fields: members });
		}
		const uncategorized = byCategory[''];
		if (uncategorized) ordered.push({ id: '', name: null, fields: uncategorized });
		return ordered;
	});

	const hasPublicField = $derived(fields.some((def) => def.isPublic));

	let draft = $state<Record<string, string>>({});
	let seededFor = $state('');
	let isSaving = $state(false);

	/** Every input holds a string; the stored shape is rebuilt on save. */
	function toInputValue(def: FieldDefinition, value: unknown): string {
		if (value === null || value === undefined) return def.type === 'boolean' ? 'false' : '';
		if (def.type === 'money') return typeof value === 'number' ? centsToDollarInput(value) : '';
		if (def.type === 'boolean') return value ? 'true' : 'false';
		return String(value);
	}

	// Reseeding only when the record or the field set changes keeps a live query
	// update from wiping out edits the user has not saved yet.
	$effect(() => {
		if (!contact) return;
		const signature = `${contact._id}:${fields.map((def) => def.key).join(',')}`;
		if (signature === seededFor) return;
		seededFor = signature;
		const next: Record<string, string> = {};
		for (const def of fields) {
			next[def.key] = toInputValue(def, attributeValue(contact.customFields, def));
		}
		draft = next;
	});

	function optionCollection(def: FieldDefinition) {
		return createListCollection({
			items: (def.options ?? []).map((option) => ({ value: option, label: option }))
		});
	}

	function buildAttributes(): Record<string, string | number | boolean | null> {
		const attributes: Record<string, string | number | boolean | null> = {};
		for (const def of fields) {
			const raw = draft[def.key] ?? '';
			if (def.type === 'money') {
				const trimmed = raw.trim();
				if (trimmed === '') {
					attributes[def.key] = null;
					continue;
				}
				// The shared dollars parser, so the stored value is integer cents and
				// a third decimal place is rejected instead of rounded.
				const cents = dollarsToCents(trimmed);
				if (cents === null) throw new Error(m.settings_amountInvalid());
				attributes[def.key] = cents;
				continue;
			}
			attributes[def.key] = coerceFieldValue(def, raw) as string | number | boolean | null;
		}
		return attributes;
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canWrite) return;

		let attributes: Record<string, string | number | boolean | null>;
		try {
			attributes = buildAttributes();
		} catch (error: unknown) {
			toast.error(error instanceof Error ? error.message : m.state_saveFailed());
			return;
		}

		if (missingRequiredFields(fields, attributes).length > 0) {
			toast.error(m.contactDetail_missingRequired());
			return;
		}

		isSaving = true;
		try {
			await client.mutation(api.customFields.mutations.setRecordAttributes, {
				entity: 'contact',
				recordId: contactId,
				attributes,
				campaignId: campaignId ?? undefined
			});
			toast.success(m.contactDetail_customSaved());
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

{#if loading}
	<div class="flex flex-col gap-3 pt-2">
		<Skeleton class="h-6 w-1/2" />
		<Skeleton class="h-32 w-full" />
	</div>
{:else if fields.length === 0}
	<EmptyState title={m.contactDetail_noCustomFields()} />
{:else}
	<form class="flex flex-col gap-4" onsubmit={handleSubmit}>
		{#each groups as group (group.id)}
			<Card.Root>
				<Card.Header>
					<Card.Title>{group.name ?? m.settings_categoryUncategorized()}</Card.Title>
					{#if hasPublicField && group.fields.some((def) => def.isPublic)}
						<Card.Description>{m.settings_fieldPublicWarning()}</Card.Description>
					{/if}
				</Card.Header>
				<Card.Content>
					<div class="grid gap-4 sm:grid-cols-2">
						{#each group.fields as def (def.key)}
							<div class="flex flex-col gap-2">
								<Label for={`contact-field-${def.key}`} class="flex flex-wrap items-center gap-2">
									{def.label}
									{#if def.isRequired}
										<Badge variant="outline">{m.settings_fieldRequired()}</Badge>
									{/if}
									{#if def.isPublic}
										<Badge variant="warning" class="gap-1">
											<EyeIcon class="size-3" aria-hidden="true" />
											{m.settings_fieldPublic()}
										</Badge>
									{/if}
								</Label>

								{#if def.type === 'longtext'}
									<Textarea
										id={`contact-field-${def.key}`}
										bind:value={draft[def.key]}
										rows={3}
										disabled={!canWrite}
										required={def.isRequired}
									/>
								{:else if def.type === 'boolean'}
									<Switch
										id={`contact-field-${def.key}`}
										checked={draft[def.key] === 'true'}
										disabled={!canWrite}
										onCheckedChange={(details: SwitchCheckedChangeDetails): void => {
											draft[def.key] = details.checked ? 'true' : 'false';
										}}
									/>
								{:else if def.type === 'select'}
									<!--
										Via `ids`, never as an `id` on Select.Trigger: zag looks its
										positioning anchor up by that exact id, so overwriting it
										leaves the menu unpositioned at the page's top-left.
									-->
									<Select.Root
										collection={optionCollection(def)}
										ids={{ trigger: `contact-field-${def.key}` }}
										value={draft[def.key] ? [draft[def.key]] : []}
										disabled={!canWrite}
										onValueChange={(details: { value: string[] }): void => {
											draft[def.key] = details.value[0] ?? '';
										}}
									>
										<Select.Trigger class="w-full" placeholder="" />
										<Select.Content>
											{#each optionCollection(def).items as option (option.value)}
												<Select.Item item={option}>
													<Select.ItemText>{option.label}</Select.ItemText>
												</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								{:else if def.type === 'date'}
									<Input
										id={`contact-field-${def.key}`}
										type="date"
										bind:value={draft[def.key]}
										disabled={!canWrite}
										required={def.isRequired}
									/>
								{:else if def.type === 'number'}
									<Input
										id={`contact-field-${def.key}`}
										type="number"
										bind:value={draft[def.key]}
										disabled={!canWrite}
										required={def.isRequired}
									/>
								{:else if def.type === 'money'}
									<Input
										id={`contact-field-${def.key}`}
										class="text-right tabular-nums"
										inputmode="decimal"
										bind:value={draft[def.key]}
										disabled={!canWrite}
										required={def.isRequired}
										aria-invalid={draft[def.key]?.trim() && dollarsToCents(draft[def.key]) === null
											? true
											: undefined}
									/>
								{:else}
									<Input
										id={`contact-field-${def.key}`}
										bind:value={draft[def.key]}
										disabled={!canWrite}
										required={def.isRequired}
									/>
								{/if}
							</div>
						{/each}
					</div>
				</Card.Content>
			</Card.Root>
		{/each}

		{#if canWrite}
			<div class="flex justify-end">
				<Button type="submit" loading={isSaving} disabled={isSaving}>{m.action_save()}</Button>
			</div>
		{/if}
	</form>
{/if}
