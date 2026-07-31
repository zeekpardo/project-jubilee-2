<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import StageFormDialog from './StageFormDialog.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import type { PipelineStage } from './types';
	import * as m from '$lib/i18n/messages';

	let { campaignId }: { campaignId: Id<'campaigns'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	const stagesResponse = useQuery(api.pipelineStages.queries.listStages, () =>
		auth.isAuthenticated ? { campaignId } : 'skip'
	);
	const stages = $derived((stagesResponse.data ?? []) as PipelineStage[]);
	const isLoading = $derived(stagesResponse.isLoading);

	let formOpen = $state(false);
	let editing = $state<PipelineStage | null>(null);
	let deleteOpen = $state(false);
	let deleting = $state<PipelineStage | null>(null);
	let isReordering = $state(false);

	function openCreate(): void {
		editing = null;
		formOpen = true;
	}

	function openEdit(stage: PipelineStage): void {
		editing = stage;
		formOpen = true;
	}

	function openDelete(stage: PipelineStage): void {
		deleting = stage;
		deleteOpen = true;
	}

	/** Why this stage's delete control is inert, or null when it may be deleted. */
	function deleteBlockedReason(stage: PipelineStage): string | null {
		if (stage.isSystem) return m.settings_stageSystemLocked();
		if (stage.isDefault) return m.settings_stageDefaultLocked();
		return null;
	}

	async function move(index: number, delta: number): Promise<void> {
		const target = index + delta;
		if (isReordering || target < 0 || target >= stages.length) return;

		// reorderStages rewrites every row's order from this array, so it must carry
		// every stage in the campaign exactly once — not just the pair that moved.
		const orderedStageIds = stages.map((stage) => stage._id);
		const moved = orderedStageIds[index];
		orderedStageIds[index] = orderedStageIds[target];
		orderedStageIds[target] = moved;

		isReordering = true;
		try {
			await client.mutation(api.pipelineStages.mutations.reorderStages, {
				campaignId,
				orderedStageIds
			});
		} catch (error: unknown) {
			toast.error(
				error instanceof ConvexError
					? String(error.data)
					: error instanceof Error
						? error.message
						: m.state_saveFailed()
			);
		} finally {
			isReordering = false;
		}
	}

	async function confirmDelete(): Promise<void> {
		if (!deleting) return;
		await client.mutation(api.pipelineStages.mutations.deleteStage, { stageId: deleting._id });
		toast.success(m.settings_stageDeleted());
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.settings_pipeline()}</Card.Title>
		<Card.Action>
			<Button onclick={openCreate}>
				<PlusIcon />
				{m.settings_stageNew()}
			</Button>
		</Card.Action>
	</Card.Header>
	<Card.Content>
		{#if isLoading}
			<div class="flex flex-col gap-2">
				<Skeleton class="h-10 w-full" />
				<Skeleton class="h-10 w-full" />
				<Skeleton class="h-10 w-full" />
			</div>
		{:else if stages.length === 0}
			<EmptyState title={m.settings_pipelineEmpty()}>
				{#snippet icon()}
					<LayersIcon />
				{/snippet}
			</EmptyState>
		{:else}
			<Table.Root>
				<Table.Header class="bg-muted">
					<Table.Row>
						<Table.Head class="w-16">{m.settings_stageOrder()}</Table.Head>
						<Table.Head>{m.settings_stageLabel()}</Table.Head>
						<Table.Head>{m.settings_stageKey()}</Table.Head>
						<Table.Head>{m.settings_stageKind()}</Table.Head>
						<Table.Head>{m.field_status()}</Table.Head>
						<Table.Head class="text-right">{m.field_actions()}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each stages as stage, index (stage._id)}
						{@const blocked = deleteBlockedReason(stage)}
						<Table.Row>
							<Table.Cell class="text-muted-foreground tabular-nums">{index + 1}</Table.Cell>
							<Table.Cell class="font-medium">
								<span class="flex items-center gap-2">
									<span
										class="border-border size-2.5 shrink-0 rounded-full border"
										style:background-color={stage.accent ?? 'transparent'}
									></span>
									{stage.label}
								</span>
							</Table.Cell>
							<Table.Cell class="text-muted-foreground font-mono text-xs">{stage.key}</Table.Cell>
							<Table.Cell>
								<Badge variant={stage.kind === 'terminal' ? 'outline' : 'secondary'}>
									{stage.kind === 'terminal'
										? m.settings_stageKind_terminal()
										: m.settings_stageKind_funnel()}
								</Badge>
							</Table.Cell>
							<Table.Cell>
								<span class="flex flex-wrap gap-1">
									{#if stage.isDefault}
										<Badge variant="default">{m.settings_stageDefault()}</Badge>
									{/if}
									{#if stage.isFundedGate}
										<Badge variant="success">{m.settings_stageFundedGate()}</Badge>
									{/if}
									{#if stage.isSystem}
										<Badge variant="outline">{m.settings_stageSystem()}</Badge>
									{/if}
								</span>
							</Table.Cell>
							<Table.Cell>
								<span class="flex items-center justify-end gap-1">
									<Button
										variant="ghost"
										size="icon"
										aria-label={m.settings_stageMoveUp()}
										title={m.settings_stageMoveUp()}
										disabled={index === 0 || isReordering}
										onclick={() => move(index, -1)}
									>
										<ChevronUpIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										aria-label={m.settings_stageMoveDown()}
										title={m.settings_stageMoveDown()}
										disabled={index === stages.length - 1 || isReordering}
										onclick={() => move(index, 1)}
									>
										<ChevronDownIcon />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										aria-label={m.action_edit()}
										title={m.action_edit()}
										onclick={() => openEdit(stage)}
									>
										<PencilIcon />
									</Button>
									<!-- The span carries the tooltip: a disabled button takes no pointer events. -->
									<span title={blocked ?? m.action_delete()} class="inline-flex">
										<Button
											variant="ghost"
											size="icon"
											aria-label={m.action_delete()}
											disabled={blocked !== null}
											onclick={() => openDelete(stage)}
										>
											<Trash2Icon />
										</Button>
									</span>
								</span>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</Card.Content>
</Card.Root>

<StageFormDialog bind:open={formOpen} {campaignId} stage={editing} nextOrder={stages.length} />

<ConfirmDialog
	bind:open={deleteOpen}
	title={m.settings_stageDeleteTitle()}
	body={m.settings_stageDeleteBody({ label: deleting?.label ?? '' })}
	onConfirm={confirmDelete}
/>
