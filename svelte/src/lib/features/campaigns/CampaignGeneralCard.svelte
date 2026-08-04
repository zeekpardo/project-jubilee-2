<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Switch } from '$lib/primitives/ui/switch';
	import * as Select from '$lib/primitives/ui/select';
	import { createListCollection } from '@ark-ui/svelte/select';
	import type { SwitchCheckedChangeDetails } from '$lib/primitives/ui/switch';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import type { Campaign } from './types';
	import * as m from '$lib/i18n/messages';

	let { campaign, canWrite }: { campaign: Campaign; canWrite: boolean } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let name = $state('');
	let numberPrefix = $state('');
	let objectLabel = $state('');
	let objectLabelPlural = $state('');
	let goalLabel = $state('');
	let goalVerb = $state('');
	let goalTrigger = $state<Campaign['goalTrigger']>('manual');
	let budgetShape = $state<Campaign['budgetShape']>('flat');
	let status = $state<Campaign['status']>('active');
	let membersEnabled = $state(false);
	let tripsEnabled = $state(false);
	let isSaving = $state(false);

	// One-time seed — the parent page only mounts this card once the campaign
	// has finished loading, so a live update never has a chance to fight
	// in-progress typing.
	let loaded = $state(false);
	$effect(() => {
		if (loaded) return;
		name = campaign.name;
		numberPrefix = campaign.numberPrefix;
		objectLabel = campaign.objectLabel;
		objectLabelPlural = campaign.objectLabelPlural;
		goalLabel = campaign.goalLabel;
		goalVerb = campaign.goalVerb;
		goalTrigger = campaign.goalTrigger;
		budgetShape = campaign.budgetShape;
		status = campaign.status;
		membersEnabled = campaign.membersEnabled;
		// Optional column: absent means off, and it is coerced here rather than
		// left `undefined` so the Switch is always controlled. PLAN-trips.md §2.
		tripsEnabled = campaign.tripsEnabled === true;
		loaded = true;
	});

	const goalTriggerCollection = createListCollection({
		items: [
			{ value: 'manual', label: m.campaignDetail_goalTrigger_manual() },
			{ value: 'stage', label: m.campaignDetail_goalTrigger_stage() },
			{ value: 'task', label: m.campaignDetail_goalTrigger_task() }
		]
	});

	const budgetShapeCollection = createListCollection({
		items: [
			{ value: 'flat', label: m.campaignDetail_budgetShape_flat() },
			{ value: 'template', label: m.campaignDetail_budgetShape_template() },
			{ value: 'none', label: m.campaignDetail_budgetShape_none() }
		]
	});

	const statusCollection = createListCollection({
		items: [
			{ value: 'active', label: m.campaigns_status_active() },
			{ value: 'paused', label: m.campaigns_status_paused() },
			{ value: 'archived', label: m.campaigns_status_archived() }
		]
	});

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canWrite) return;
		isSaving = true;
		try {
			await client.mutation(api.campaigns.mutations.updateCampaign, {
				campaignId: campaign._id,
				name: name.trim(),
				numberPrefix: numberPrefix.trim(),
				objectLabel: objectLabel.trim(),
				objectLabelPlural: objectLabelPlural.trim(),
				goalLabel: goalLabel.trim(),
				goalVerb: goalVerb.trim(),
				goalTrigger,
				budgetShape,
				status,
				membersEnabled,
				tripsEnabled
			});
			toast.success(m.campaigns_updated());
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.campaignDetail_settingsTitle()}</Card.Title>
	</Card.Header>
	<Card.Content>
		<form class="flex flex-col gap-8" onsubmit={save}>
			<div class="flex flex-col gap-4">
				<div class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
					{m.campaignDetail_sectionIdentity()}
				</div>
				<div class="flex flex-col gap-2">
					<Label for="campaign-settings-name">{m.field_name()}</Label>
					<Input id="campaign-settings-name" bind:value={name} disabled={!canWrite} required />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="campaign-settings-slug">{m.field_slug()}</Label>
					<Input id="campaign-settings-slug" value={campaign.slug} readonly disabled />
					<p class="text-muted-foreground text-xs">
						{m.campaignDetail_slugLocked({ slug: campaign.slug })}
					</p>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="campaign-settings-number-prefix">{m.campaigns_numberPrefix()}</Label>
					<Input
						id="campaign-settings-number-prefix"
						bind:value={numberPrefix}
						disabled={!canWrite}
						required
					/>
				</div>
			</div>

			<div class="flex flex-col gap-4 border-t pt-6">
				<div class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
					{m.campaignDetail_sectionVocabulary()}
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-2">
						<Label for="campaign-settings-object-label">{m.campaigns_objectLabel()}</Label>
						<Input
							id="campaign-settings-object-label"
							bind:value={objectLabel}
							disabled={!canWrite}
							required
						/>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="campaign-settings-object-label-plural">
							{m.campaigns_objectLabelPlural()}
						</Label>
						<Input
							id="campaign-settings-object-label-plural"
							bind:value={objectLabelPlural}
							disabled={!canWrite}
							required
						/>
					</div>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-2">
						<Label for="campaign-settings-goal-label">{m.campaigns_goalLabel()}</Label>
						<Input
							id="campaign-settings-goal-label"
							bind:value={goalLabel}
							disabled={!canWrite}
							required
						/>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="campaign-settings-goal-verb">{m.campaigns_goalVerb()}</Label>
						<Input
							id="campaign-settings-goal-verb"
							bind:value={goalVerb}
							disabled={!canWrite}
							required
						/>
					</div>
				</div>
			</div>

			<div class="flex flex-col gap-4 border-t pt-6">
				<div class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
					{m.campaignDetail_sectionConfiguration()}
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-2">
						<Label for="campaign-settings-goal-trigger">{m.campaignDetail_goalTrigger()}</Label>
						<Select.Root
							collection={goalTriggerCollection}
							ids={{ trigger: 'campaign-settings-goal-trigger' }}
							value={[goalTrigger]}
							disabled={!canWrite}
							onValueChange={(details: { value: string[] }): void => {
								const next = details.value[0];
								if (next) goalTrigger = next as Campaign['goalTrigger'];
							}}
						>
							<Select.Trigger class="w-full" />
							<Select.Content>
								{#each goalTriggerCollection.items as option (option.value)}
									<Select.Item item={option}>
										<Select.ItemText>{option.label}</Select.ItemText>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="campaign-settings-budget-shape">{m.campaignDetail_budgetShape()}</Label>
						<Select.Root
							collection={budgetShapeCollection}
							ids={{ trigger: 'campaign-settings-budget-shape' }}
							value={[budgetShape]}
							disabled={!canWrite}
							onValueChange={(details: { value: string[] }): void => {
								const next = details.value[0];
								if (next) budgetShape = next as Campaign['budgetShape'];
							}}
						>
							<Select.Trigger class="w-full" />
							<Select.Content>
								{#each budgetShapeCollection.items as option (option.value)}
									<Select.Item item={option}>
										<Select.ItemText>{option.label}</Select.ItemText>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="campaign-settings-status">{m.field_status()}</Label>
					<Select.Root
						collection={statusCollection}
						ids={{ trigger: 'campaign-settings-status' }}
						value={[status]}
						disabled={!canWrite}
						onValueChange={(details: { value: string[] }): void => {
							const next = details.value[0];
							if (next) status = next as Campaign['status'];
						}}
					>
						<Select.Trigger class="w-full" />
						<Select.Content>
							{#each statusCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex items-start justify-between gap-4 rounded-md border p-4">
					<div class="min-w-0">
						<Label>{m.campaignDetail_membersEnabled()}</Label>
						<p class="text-muted-foreground mt-1 text-sm">
							{m.campaignDetail_membersEnabledHelp()}
						</p>
					</div>
					<Switch
						checked={membersEnabled}
						disabled={!canWrite}
						onCheckedChange={(details: SwitchCheckedChangeDetails): void => {
							membersEnabled = details.checked;
						}}
					/>
				</div>
				<div class="flex items-start justify-between gap-4 rounded-md border p-4">
					<div class="min-w-0">
						<Label>{m.campaignDetail_tripsEnabled()}</Label>
						<p class="text-muted-foreground mt-1 text-sm">
							{m.campaignDetail_tripsEnabledHelp()}
						</p>
					</div>
					<Switch
						checked={tripsEnabled}
						disabled={!canWrite}
						onCheckedChange={(details: SwitchCheckedChangeDetails): void => {
							tripsEnabled = details.checked;
						}}
					/>
				</div>
			</div>

			{#if canWrite}
				<div class="flex justify-end">
					<Button type="submit" loading={isSaving} disabled={isSaving}>
						{m.action_saveChanges()}
					</Button>
				</div>
			{/if}
		</form>
	</Card.Content>
</Card.Root>
