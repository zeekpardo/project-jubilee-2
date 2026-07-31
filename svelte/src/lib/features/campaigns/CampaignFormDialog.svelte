<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import * as Select from '$lib/primitives/ui/select';
	import { Switch } from '$lib/primitives/ui/switch';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { toast } from 'svelte-sonner';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	// Rules
	import { suggestSlug } from './slug';
	import type { Campaign } from './types';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const client = useConvexClient();

	let {
		open = $bindable(false),
		campaign = null
	}: {
		open?: boolean;
		/** Null creates, a campaign edits. */
		campaign?: Campaign | null;
	} = $props();

	let name = $state('');
	let slug = $state('');
	let slugTouched = $state(false);
	let objectLabel = $state('');
	let objectLabelPlural = $state('');
	let goalLabel = $state('');
	let goalVerb = $state('');
	let numberPrefix = $state('');
	let status = $state<Campaign['status']>('active');
	let isPublished = $state(false);
	let isSaving = $state(false);

	const isEdit = $derived(campaign !== null);

	const statusCollection = createListCollection({
		items: [
			{ value: 'active', label: m.campaigns_status_active() },
			{ value: 'paused', label: m.campaigns_status_paused() },
			{ value: 'archived', label: m.campaigns_status_archived() }
		]
	});

	// Re-seed the form whenever the dialog opens, so a cancelled edit never
	// leaks into the next one.
	$effect(() => {
		if (!open) return;
		const source = campaign;
		name = source?.name ?? '';
		slug = source?.slug ?? '';
		slugTouched = source !== null;
		objectLabel = source?.objectLabel ?? '';
		objectLabelPlural = source?.objectLabelPlural ?? '';
		goalLabel = source?.goalLabel ?? '';
		goalVerb = source?.goalVerb ?? '';
		numberPrefix = source?.numberPrefix ?? '';
		status = source?.status ?? 'active';
		isPublished = source?.isPublished ?? false;
	});

	const canSubmit = $derived(
		name.trim().length > 0 &&
			slug.trim().length > 0 &&
			objectLabel.trim().length > 0 &&
			objectLabelPlural.trim().length > 0 &&
			goalLabel.trim().length > 0 &&
			goalVerb.trim().length > 0
	);

	function handleNameInput(event: Event): void {
		name = (event.target as HTMLInputElement).value;
		if (!slugTouched) slug = suggestSlug(name);
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;

		const fields = {
			name: name.trim(),
			slug: slug.trim(),
			objectLabel: objectLabel.trim(),
			objectLabelPlural: objectLabelPlural.trim(),
			goalLabel: goalLabel.trim(),
			goalVerb: goalVerb.trim(),
			numberPrefix: numberPrefix.trim() || undefined
		};

		try {
			if (campaign) {
				await client.mutation(api.campaigns.mutations.updateCampaign, {
					campaignId: campaign._id,
					...fields,
					status,
					isPublished
				});
			} else {
				await client.mutation(api.campaigns.mutations.createCampaign, fields);
			}
			toast.success(campaign ? m.campaigns_updated() : m.campaigns_created());
			open = false;
		} catch (error: unknown) {
			toast.error(error instanceof Error ? error.message : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-xl">
		<Dialog.Header class="w-full">
			<Dialog.Title>{isEdit ? m.campaigns_edit() : m.campaigns_new()}</Dialog.Title>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<div class="flex flex-col gap-2">
				<Label for="campaign-name">{m.field_name()}</Label>
				<Input id="campaign-name" value={name} oninput={handleNameInput} required />
			</div>

			<div class="flex flex-col gap-2">
				<Label for="campaign-slug">{m.field_slug()}</Label>
				<Input id="campaign-slug" bind:value={slug} oninput={() => (slugTouched = true)} required />
				<p class="text-muted-foreground text-xs">{m.campaigns_slugHelp()}</p>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="campaign-object-label">{m.campaigns_objectLabel()}</Label>
					<Input id="campaign-object-label" bind:value={objectLabel} required />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="campaign-object-label-plural">{m.campaigns_objectLabelPlural()}</Label>
					<Input id="campaign-object-label-plural" bind:value={objectLabelPlural} required />
				</div>
				<p class="text-muted-foreground text-xs sm:col-span-2">{m.campaigns_objectLabelHelp()}</p>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="campaign-goal-label">{m.campaigns_goalLabel()}</Label>
					<Input id="campaign-goal-label" bind:value={goalLabel} required />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="campaign-goal-verb">{m.campaigns_goalVerb()}</Label>
					<Input id="campaign-goal-verb" bind:value={goalVerb} required />
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<Label for="campaign-number-prefix">{m.campaigns_numberPrefix()}</Label>
				<Input id="campaign-number-prefix" bind:value={numberPrefix} />
			</div>

			{#if isEdit}
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-2">
						<Label>{m.field_status()}</Label>
						<Select.Root
							collection={statusCollection}
							value={[status]}
							onValueChange={(details: { value: string[] }): void => {
								const next = details.value[0];
								if (next) status = next as Campaign['status'];
							}}
						>
							<Select.Trigger class="w-full" placeholder={m.field_status()} />
							<Select.Content>
								{#each statusCollection.items as option (option.value)}
									<Select.Item item={option}>
										<Select.ItemText>{option.label}</Select.ItemText>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="flex items-end">
						<Switch bind:checked={isPublished}>{m.campaigns_published()}</Switch>
					</div>
				</div>
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
