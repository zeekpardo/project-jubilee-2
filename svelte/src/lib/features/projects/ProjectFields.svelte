<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import * as Select from '$lib/primitives/ui/select';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Switch } from '$lib/primitives/ui/switch';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { createListCollection } from '@ark-ui/svelte/select';
	import type { SwitchCheckedChangeDetails } from '$lib/primitives/ui/switch';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc } from '$convex/_generated/dataModel';

	import { Can, getAccessContext } from '$lib/access';
	import { attributeValue, coerceFieldValue } from '$lib/domain/field-definitions';
	import { centsToDollarInput, dollarsToCents } from '$lib/features/settings/amount';
	import * as m from '$lib/i18n/messages';
	import type { ProjectFieldDefinition } from './types';

	let { project }: { project: Doc<'projects'> } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();
	const access = getAccessContext();

	const canWrite = $derived(access.can('projects:write', project.campaignId));

	const fieldsResponse = useQuery(api.customFields.queries.resolveFields, () => ({
		entity: 'project' as const,
		campaignId: project.campaignId
	}));
	const fields = $derived(fieldsResponse.data ?? []);

	let draft = $state<Record<string, string>>({});
	let seededFor = $state('');
	let isSaving = $state(false);

	/** Every input holds a string; the stored shape is rebuilt on save. */
	function toInputValue(def: ProjectFieldDefinition, value: unknown): string {
		if (value === null || value === undefined) return def.type === 'boolean' ? 'false' : '';
		if (def.type === 'money') {
			return typeof value === 'number' ? centsToDollarInput(value) : '';
		}
		if (def.type === 'boolean') return value ? 'true' : 'false';
		return String(value);
	}

	// Reseeding only when the record or the field set changes keeps a live query
	// update from wiping out edits the user has not saved yet.
	$effect(() => {
		const signature = `${project._id}:${fields.map((def) => def.key).join(',')}`;
		if (signature === seededFor) return;
		seededFor = signature;
		const next: Record<string, string> = {};
		for (const def of fields) {
			next[def.key] = toInputValue(def, attributeValue(project.attributes, def));
		}
		draft = next;
	});

	const hasPublicField = $derived(fields.some((def) => def.isPublic));

	function optionCollection(def: ProjectFieldDefinition) {
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

		isSaving = true;
		try {
			await client.mutation(api.customFields.mutations.setRecordAttributes, {
				entity: 'project',
				recordId: project._id,
				attributes
			});
			toast.success(m.projects_fieldsSaved());
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

<Card.Root>
	<Card.Header>
		<Card.Title>{m.projects_customFields()}</Card.Title>
		{#if hasPublicField}
			<Card.Description>{m.settings_fieldPublicWarning()}</Card.Description>
		{/if}
	</Card.Header>
	<Card.Content>
		{#if fieldsResponse.isLoading}
			<div class="flex flex-col gap-3">
				<Skeleton class="h-6 w-full" />
				<Skeleton class="h-6 w-full" />
			</div>
		{:else if fields.length === 0}
			<EmptyState variant="plain" size="sm" title={m.state_empty()} />
		{:else}
			<form class="flex flex-col gap-4" onsubmit={handleSubmit}>
				<div class="grid gap-4 sm:grid-cols-2">
					{#each fields as def (def.key)}
						<div class="flex flex-col gap-2">
							<Label for={`project-field-${def.key}`} class="flex items-center gap-2">
								{def.label}
								{#if def.isPublic}
									<Badge variant="warning" class="gap-1">
										<EyeIcon class="size-3" aria-hidden="true" />
										{m.settings_fieldPublic()}
									</Badge>
								{/if}
							</Label>

							{#if def.type === 'longtext'}
								<Textarea
									id={`project-field-${def.key}`}
									bind:value={draft[def.key]}
									rows={3}
									disabled={!canWrite}
									required={def.isRequired}
								/>
							{:else if def.type === 'boolean'}
								<Switch
									id={`project-field-${def.key}`}
									checked={draft[def.key] === 'true'}
									disabled={!canWrite}
									onCheckedChange={(details: SwitchCheckedChangeDetails): void => {
										draft[def.key] = details.checked ? 'true' : 'false';
									}}
								/>
							{:else if def.type === 'select'}
								<Select.Root
									collection={optionCollection(def)}
									value={draft[def.key] ? [draft[def.key]] : []}
									disabled={!canWrite}
									onValueChange={(details: { value: string[] }): void => {
										draft[def.key] = details.value[0] ?? '';
									}}
								>
									<Select.Trigger id={`project-field-${def.key}`} class="w-full" placeholder="" />
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
									id={`project-field-${def.key}`}
									type="date"
									bind:value={draft[def.key]}
									disabled={!canWrite}
									required={def.isRequired}
								/>
							{:else if def.type === 'number'}
								<Input
									id={`project-field-${def.key}`}
									type="number"
									bind:value={draft[def.key]}
									disabled={!canWrite}
									required={def.isRequired}
								/>
							{:else if def.type === 'money'}
								<Input
									id={`project-field-${def.key}`}
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
									id={`project-field-${def.key}`}
									bind:value={draft[def.key]}
									disabled={!canWrite}
									required={def.isRequired}
								/>
							{/if}
						</div>
					{/each}
				</div>

				<Can do="projects:write" campaignId={project.campaignId}>
					<div class="flex justify-end">
						<Button type="submit" loading={isSaving} disabled={isSaving}>
							{m.projects_saveFields()}
						</Button>
					</div>
				</Can>
			</form>
		{/if}
	</Card.Content>
</Card.Root>
