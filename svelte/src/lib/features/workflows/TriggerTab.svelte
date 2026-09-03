<script lang="ts">
	// What starts a run.
	//
	// Deliberately three, and the union is narrow on purpose: whatever the
	// trigger, the same guard applies downstream — one open run per record, and
	// a run needs a record to be about.

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import * as Select from '$lib/primitives/ui/select';
	import { createListCollection } from '@ark-ui/svelte/select';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import type { WorkflowDraft, WorkflowTriggerKind } from './types';
	import type { Id } from '$convex/_generated/dataModel';
	import { WORKFLOW_TRIGGER_KINDS, triggerKindHelp, triggerKindLabel } from './labels';
	import * as m from '$lib/i18n/messages';

	let { draft, campaignId }: { draft: WorkflowDraft; campaignId: Id<'campaigns'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();

	const stagesResponse = useQuery(api.pipelineStages.queries.listStages, () =>
		auth.isAuthenticated ? { campaignId } : 'skip'
	);
	const stages = $derived(stagesResponse.data ?? []);

	const kindCollection = createListCollection({
		items: WORKFLOW_TRIGGER_KINDS.map((value) => ({ value, label: triggerKindLabel(value) }))
	});

	const stageCollection = $derived(
		createListCollection({
			items: stages.map((stage) => ({ value: stage.key, label: stage.label }))
		})
	);

	/**
	 * Each kind carries its own payload, so switching kind REPLACES the trigger
	 * rather than editing it. A `stageKey` left lying beside `kind: 'manual'`
	 * would be a rule the object still holds and nothing runs.
	 */
	function setKind(kind: WorkflowTriggerKind): void {
		if (draft.trigger.kind === kind) return;
		if (kind === 'manual') draft.trigger = { kind: 'manual' };
		else if (kind === 'stage_change') draft.trigger = { kind: 'stage_change', stageKey: '' };
		else draft.trigger = { kind: 'schedule', everyMonths: 3 };
	}

	const stageKey = $derived(draft.trigger.kind === 'stage_change' ? draft.trigger.stageKey : '');
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.workflows_trigger_title()}</Card.Title>
		<Card.Description>{m.workflows_trigger_body()}</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
		<div class="flex flex-col gap-2">
			<Label for="trigger-kind">{m.workflows_trigger()}</Label>
			<Select.Root
				triggerId="trigger-kind"
				collection={kindCollection}
				value={[draft.trigger.kind]}
				onValueChange={(details: { value: string[] }): void => {
					const next = details.value[0];
					if (next) setKind(next as WorkflowTriggerKind);
				}}
			>
				<Select.Trigger class="w-full" placeholder={m.workflows_trigger()} />
				<Select.Content>
					{#each kindCollection.items as option (option.value)}
						<Select.Item item={option}>
							<Select.ItemText>{option.label}</Select.ItemText>
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<p class="text-muted-foreground text-xs">{triggerKindHelp(draft.trigger.kind)}</p>
		</div>

		{#if draft.trigger.kind === 'stage_change'}
			<div class="flex flex-col gap-2">
				<Label for="trigger-stage">{m.workflows_trigger_stage()}</Label>
				{#if stages.length === 0}
					<p class="text-muted-foreground text-sm">{m.workflows_trigger_noStages()}</p>
				{:else}
					<Select.Root
						triggerId="trigger-stage"
						collection={stageCollection}
						value={stageKey ? [stageKey] : []}
						onValueChange={(details: { value: string[] }): void => {
							const next = details.value[0];
							if (next && draft.trigger.kind === 'stage_change') draft.trigger.stageKey = next;
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.workflows_trigger_stagePlaceholder()} />
						<Select.Content>
							{#each stageCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				{/if}
			</div>
		{:else if draft.trigger.kind === 'schedule'}
			<div class="flex flex-col gap-2">
				<Label for="trigger-months">{m.workflows_trigger_everyMonths()}</Label>
				<!--
					A REQUIRED number, unlike the optional thresholds elsewhere: "every
					undefined months" is not a schedule. A blank box therefore falls
					back to the value the field already held rather than clearing it.
				-->
				<Input
					id="trigger-months"
					type="number"
					min={1}
					step="1"
					inputmode="numeric"
					value={String(draft.trigger.everyMonths)}
					oninput={(event) => {
						const parsed = Number(event.currentTarget.value);
						if (draft.trigger.kind === 'schedule' && Number.isFinite(parsed) && parsed >= 1) {
							draft.trigger.everyMonths = Math.round(parsed);
						}
					}}
				/>
				<p class="text-muted-foreground text-xs">{m.workflows_trigger_scheduleNote()}</p>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
