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
	import InfoIcon from '@lucide/svelte/icons/info';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import TaskTemplateVersionDialog from './TaskTemplateVersionDialog.svelte';
	import type { TaskTemplate, TaskTemplateItem } from './types';
	import * as m from '$lib/i18n/messages';

	let { campaignId }: { campaignId: Id<'campaigns'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	const templatesResponse = useQuery(api.taskTemplates.queries.listTaskTemplates, () =>
		auth.isAuthenticated ? { campaignId } : 'skip'
	);
	// The query reads an isActive index, so the rows arrive grouped by flag rather
	// than by age; newest first is what a version history should read as.
	const templates = $derived(
		[...((templatesResponse.data ?? []) as TaskTemplate[])].sort(
			(a, b) => b._creationTime - a._creationTime
		)
	);
	const isLoading = $derived(templatesResponse.isLoading);

	let dialogOpen = $state(false);
	let activatingId = $state<string | null>(null);

	function sortedItems(template: TaskTemplate): TaskTemplateItem[] {
		return [...template.items].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
	}

	function impactLabel(tag: TaskTemplateItem['impactTag']): string {
		if (tag === 'business') return m.settings_impactTag_business();
		if (tag === 'school') return m.settings_impactTag_school();
		return m.settings_impactTag_none();
	}

	async function activate(template: TaskTemplate): Promise<void> {
		if (activatingId) return;
		activatingId = template._id;
		try {
			await client.mutation(api.taskTemplates.mutations.activateTaskTemplate, {
				taskTemplateId: template._id
			});
			toast.success(m.settings_activated());
		} catch (error: unknown) {
			toast.error(
				error instanceof ConvexError
					? String(error.data)
					: error instanceof Error
						? error.message
						: m.state_saveFailed()
			);
		} finally {
			activatingId = null;
		}
	}
</script>

<div class="flex flex-col gap-4">
	<Alert.Root>
		<InfoIcon class="size-4" />
		<Alert.Description>{m.settings_appendOnlyNote()}</Alert.Description>
	</Alert.Root>

	<div class="flex justify-end">
		<Button onclick={() => (dialogOpen = true)}>
			<PlusIcon />
			{m.settings_versionNew()}
		</Button>
	</div>

	{#if isLoading}
		<div class="flex flex-col gap-3">
			<Skeleton class="h-40 w-full" />
			<Skeleton class="h-40 w-full" />
		</div>
	{:else if templates.length === 0}
		<EmptyState title={m.settings_taskEmpty()}>
			{#snippet icon()}
				<ListChecksIcon />
			{/snippet}
			{#snippet action()}
				<Button onclick={() => (dialogOpen = true)}>
					<PlusIcon />
					{m.settings_versionNew()}
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="flex flex-col gap-4">
			{#each templates as template (template._id)}
				<Card.Root>
					<Card.Header>
						<Card.Title>{m.settings_version()} {template.version}</Card.Title>
						{#if template.effectiveFrom}
							<Card.Description>
								{m.settings_effectiveFrom()}: {template.effectiveFrom}
							</Card.Description>
						{/if}
						<Card.Action>
							{#if template.isActive}
								<Badge variant="success">{m.settings_active()}</Badge>
							{:else}
								<Button
									variant="outline"
									size="sm"
									loading={activatingId === template._id}
									disabled={activatingId !== null}
									onclick={() => activate(template)}
								>
									{m.settings_activate()}
								</Button>
							{/if}
						</Card.Action>
					</Card.Header>
					<Card.Content>
						{#if template.items.length === 0}
							<EmptyState size="sm" variant="plain" title={m.state_empty()} />
						{:else}
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head class="w-16">{m.settings_stageOrder()}</Table.Head>
										<Table.Head>{m.settings_taskItemKey()}</Table.Head>
										<Table.Head>{m.settings_taskItemLabel()}</Table.Head>
										<Table.Head>{m.settings_impactTag()}</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each sortedItems(template) as item (item.key)}
										<Table.Row>
											<Table.Cell class="text-muted-foreground tabular-nums"
												>{item.order}</Table.Cell
											>
											<Table.Cell class="font-mono text-xs">{item.key}</Table.Cell>
											<Table.Cell class="font-medium">{item.label}</Table.Cell>
											<Table.Cell>
												{#if item.impactTag}
													<Badge variant="secondary">{impactLabel(item.impactTag)}</Badge>
												{:else}
													<span class="text-muted-foreground">—</span>
												{/if}
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

<TaskTemplateVersionDialog bind:open={dialogOpen} {campaignId} />
