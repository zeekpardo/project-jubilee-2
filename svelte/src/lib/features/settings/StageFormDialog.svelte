<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Switch } from '$lib/primitives/ui/switch';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import type { PipelineStage } from './types';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const client = useConvexClient();

	let {
		open = $bindable(false),
		campaignId,
		stage = null,
		nextOrder = 0
	}: {
		open?: boolean;
		campaignId: Id<'campaigns'>;
		/** Null creates, a stage edits. */
		stage?: PipelineStage | null;
		nextOrder?: number;
	} = $props();

	let label = $state('');
	let key = $state('');
	let kind = $state<PipelineStage['kind']>('funnel');
	let accent = $state('');
	let isDefault = $state(false);
	let isFundedGate = $state(false);
	let isSaving = $state(false);

	const isEdit = $derived(stage !== null);

	const kindCollection = createListCollection({
		items: [
			{ value: 'funnel', label: m.settings_stageKind_funnel() },
			{ value: 'terminal', label: m.settings_stageKind_terminal() }
		]
	});

	$effect(() => {
		if (!open) return;
		const source = stage;
		label = source?.label ?? '';
		key = source?.key ?? '';
		kind = source?.kind ?? 'funnel';
		accent = source?.accent ?? '';
		isDefault = source?.isDefault ?? false;
		isFundedGate = source?.isFundedGate ?? false;
	});

	const canSubmit = $derived(label.trim().length > 0 && (isEdit || key.trim().length > 0));

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;

		try {
			if (stage) {
				await client.mutation(api.pipelineStages.mutations.updateStage, {
					stageId: stage._id,
					label: label.trim(),
					kind,
					accent: accent.trim() || undefined,
					isDefault,
					isFundedGate
				});
			} else {
				await client.mutation(api.pipelineStages.mutations.createStage, {
					campaignId,
					key: key.trim(),
					label: label.trim(),
					order: nextOrder,
					kind,
					accent: accent.trim() || undefined,
					isDefault,
					isFundedGate
				});
			}
			toast.success(m.settings_stageSaved());
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
			<Dialog.Title>{isEdit ? m.settings_stageEdit() : m.settings_stageNew()}</Dialog.Title>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<div class="flex flex-col gap-2">
				<Label for="stage-label">{m.settings_stageLabel()}</Label>
				<Input id="stage-label" bind:value={label} required />
			</div>

			{#if !isEdit}
				<div class="flex flex-col gap-2">
					<Label for="stage-key">{m.settings_stageKey()}</Label>
					<Input id="stage-key" bind:value={key} class="font-mono" required />
					<p class="text-muted-foreground text-xs">{m.settings_stageKeyHelp()}</p>
				</div>
			{/if}

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label>{m.settings_stageKind()}</Label>
					<Select.Root
						collection={kindCollection}
						value={[kind]}
						onValueChange={(details: { value: string[] }): void => {
							const next = details.value[0];
							if (next) kind = next as PipelineStage['kind'];
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.settings_stageKind()} />
						<Select.Content>
							{#each kindCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="flex flex-col gap-2">
					<Label for="stage-accent">{m.settings_stageAccent()}</Label>
					<div class="flex items-center gap-2">
						<span
							class="border-border size-5 shrink-0 rounded-full border"
							style:background-color={accent.trim() || 'transparent'}
						></span>
						<Input id="stage-accent" bind:value={accent} placeholder="#2563eb" />
					</div>
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<Switch bind:checked={isDefault} disabled={stage?.isDefault === true}>
					{m.settings_stageDefault()}
				</Switch>
				<p class="text-muted-foreground text-xs">{m.settings_stageDefaultHelp()}</p>
			</div>

			<div class="flex flex-col gap-2">
				<Switch bind:checked={isFundedGate}>{m.settings_stageFundedGate()}</Switch>
				<p class="text-muted-foreground text-xs">{m.settings_stageFundedGateHelp()}</p>
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
