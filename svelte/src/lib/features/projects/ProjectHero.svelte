<script lang="ts">
	import { Portal } from '@ark-ui/svelte';
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { ConvexError } from 'convex/values';
	import { toast } from 'svelte-sonner';

	import * as Card from '$lib/primitives/ui/card';
	import * as Menu from '$lib/primitives/ui/menu';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Progress } from '$lib/primitives/ui/progress';
	import { InlineEdit } from '$lib/primitives/ui/inline-edit';
	import { cn } from '$lib/primitives/utils';
	import CheckIcon from '@lucide/svelte/icons/check';
	import UsersIcon from '@lucide/svelte/icons/users';
	import ClockIcon from '@lucide/svelte/icons/clock';

	import { Can, getAccessContext } from '$lib/access';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import type { PipelineStage } from '$lib/domain/stages';
	import type { Doc } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';
	import { formatCents } from './format';
	import ProjectPhoto from './ProjectPhoto.svelte';
	import StageBadge from './StageBadge.svelte';

	let {
		project,
		stages,
		goalLabel,
		raisedCents,
		targetCents
	}: {
		project: Doc<'projects'>;
		stages: PipelineStage[];
		goalLabel: string;
		raisedCents: number;
		targetCents: number;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();
	const access = getAccessContext();

	const canWrite = $derived(access.can('projects:write', project.campaignId));

	const membersResponse = useQuery(api.projectMembers.queries.listMembersForProject, () => ({
		projectId: project._id
	}));
	const peopleCount = $derived(membersResponse.data?.length ?? 0);

	const byOrder = (a: PipelineStage, b: PipelineStage) => a.order - b.order;
	const funnel = $derived(stages.filter((stage) => stage.kind === 'funnel').sort(byOrder));
	const terminal = $derived(stages.filter((stage) => stage.kind === 'terminal').sort(byOrder));

	const percent = $derived(
		targetCents > 0 ? Math.round(Math.min(1, Math.max(0, raisedCents / targetCents)) * 100) : 0
	);
	const raisedLabel = $derived(formatCents(raisedCents));
	const targetLabel = $derived(targetCents > 0 ? formatCents(targetCents) : null);

	const daysInStage = $derived(
		Math.max(0, Math.floor((Date.now() - project._creationTime) / 86_400_000))
	);

	let pendingStage = $state<PipelineStage | null>(null);
	let stageConfirmOpen = $state(false);
	let goalWorking = $state(false);

	function reject(error: unknown): Error {
		return new Error(
			error instanceof ConvexError
				? String(error.data)
				: error instanceof Error
					? error.message
					: m.state_saveFailed(),
			{ cause: error }
		);
	}

	async function saveName(next: string): Promise<void> {
		if (next === '') throw new Error(m.projectDetail_namePlaceholder());
		try {
			await client.mutation(api.projects.mutations.updateProject, {
				projectId: project._id,
				name: next
			});
		} catch (error: unknown) {
			throw reject(error);
		}
	}

	async function saveStory(next: string): Promise<void> {
		try {
			await client.mutation(api.projects.mutations.updateProject, {
				projectId: project._id,
				story: next || undefined
			});
		} catch (error: unknown) {
			throw reject(error);
		}
	}

	function askStage(stage: PipelineStage): void {
		pendingStage = stage;
		stageConfirmOpen = true;
	}

	async function confirmStage(): Promise<void> {
		const next = pendingStage;
		if (!next) return;
		await client.mutation(api.projects.mutations.setProjectStage, {
			projectId: project._id,
			stage: next.key
		});
		pendingStage = null;
	}

	// The goal flag is an independent admin status: it never moves the stage, and
	// no stage sets it.
	async function toggleGoalMet(): Promise<void> {
		if (goalWorking) return;
		goalWorking = true;
		try {
			await client.mutation(api.projects.mutations.setProjectGoalMet, {
				projectId: project._id,
				isGoalMet: !project.isGoalMet
			});
		} catch (error: unknown) {
			toast.error(reject(error).message);
		} finally {
			goalWorking = false;
		}
	}
</script>

<Card.Root>
	<Card.Content class="flex flex-col gap-6">
		<div class="flex flex-col gap-6 sm:flex-row sm:items-start">
			<ProjectPhoto projectId={project._id} {canWrite} />

			<div class="flex min-w-0 flex-1 flex-col gap-3">
				<p class="text-muted-foreground font-mono text-sm tabular-nums">{project.number}</p>

				<InlineEdit
					value={project.name}
					disabled={!canWrite}
					ariaLabel={m.field_name()}
					placeholder={m.projectDetail_namePlaceholder()}
					class="text-2xl font-bold tracking-tight lg:text-3xl"
					onSave={saveName}
				/>

				<div class="flex flex-wrap items-center gap-2">
					{#if canWrite}
						<Menu.Root>
							<Menu.Trigger aria-label={m.projectDetail_setStage()} class="cursor-pointer">
								<StageBadge stage={project.stage} {stages} />
							</Menu.Trigger>
							<Portal>
								<Menu.Content class="w-56">
									<Menu.ItemGroup>
										<Menu.ItemGroupLabel>{m.projectDetail_setStage()}</Menu.ItemGroupLabel>
										{#each funnel as stage (stage.key)}
											<Menu.Item
												value={stage.key}
												disabled={stage.key === project.stage}
												onclick={() => askStage(stage)}
											>
												<span class="truncate">{stage.label}</span>
											</Menu.Item>
										{/each}
									</Menu.ItemGroup>
									{#if terminal.length > 0}
										<Menu.Separator />
										<Menu.ItemGroup>
											{#each terminal as stage (stage.key)}
												<Menu.Item
													value={stage.key}
													disabled={stage.key === project.stage}
													onclick={() => askStage(stage)}
												>
													<span class="truncate">{stage.label}</span>
												</Menu.Item>
											{/each}
										</Menu.ItemGroup>
									{/if}
								</Menu.Content>
							</Portal>
						</Menu.Root>
					{:else}
						<StageBadge stage={project.stage} {stages} />
					{/if}

					<Can do="projects:write" campaignId={project.campaignId}>
						<button
							type="button"
							disabled={goalWorking}
							aria-pressed={project.isGoalMet}
							class={cn(
								'rounded-md border px-2 py-0.5 text-xs font-medium',
								project.isGoalMet
									? 'bg-success-500/10 text-success-700-300 border-success-500/40'
									: 'border-border text-muted-foreground hover:text-foreground'
							)}
							onclick={toggleGoalMet}
						>
							{#if project.isGoalMet}
								<CheckIcon class="mr-1 inline size-3" aria-hidden="true" />
							{/if}
							{goalLabel}
						</button>
					</Can>
				</div>

				<div class="flex flex-col gap-1.5">
					<div class="flex flex-wrap items-baseline justify-between gap-2">
						<p class="text-sm tabular-nums">
							<span class="font-semibold">{raisedLabel}</span>
							<span class="text-muted-foreground">
								{m.projectDetail_raisedOf()}
								{targetLabel ?? m.projectDetail_noTarget()}
							</span>
						</p>
						<p class="text-muted-foreground text-sm tabular-nums">{percent}%</p>
					</div>
					<Progress value={percent} />
				</div>

				<div class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
					<span class="flex items-center gap-1">
						<UsersIcon class="size-3.5" aria-hidden="true" />
						{peopleCount}
						{m.projectDetail_people()}
					</span>
					<span class="flex items-center gap-1">
						<ClockIcon class="size-3.5" aria-hidden="true" />
						{daysInStage}d {m.projectDetail_inStage()}
					</span>
					{#if project.isGoalMet}
						<Badge variant="success">{goalLabel}</Badge>
					{/if}
					{#if project.isPublished}
						<Badge variant="outline">{m.projects_published()}</Badge>
					{/if}
				</div>
			</div>
		</div>

		<div class="border-border flex flex-col gap-2 rounded-lg border p-4">
			<span class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
				{m.projectDetail_story()}
			</span>
			<InlineEdit
				value={project.story}
				multiline
				disabled={!canWrite}
				ariaLabel={m.projectDetail_story()}
				placeholder={m.projectDetail_storyPlaceholder()}
				class="text-sm leading-relaxed whitespace-pre-line"
				onSave={saveStory}
			/>
		</div>
	</Card.Content>
</Card.Root>

<ConfirmDialog
	bind:open={stageConfirmOpen}
	title={m.projectDetail_stageConfirmTitle()}
	body={m.projectDetail_stageConfirmBody()}
	confirmLabel={m.projectDetail_setStage()}
	onConfirm={confirmStage}
/>
