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
	import InfoIcon from '@lucide/svelte/icons/info';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import TaskTemplateVersionDialog from './TaskTemplateVersionDialog.svelte';
	import type { TaskTemplate, TaskTemplateItem, TaskTemplateScope } from './types';
	import * as m from '$lib/i18n/messages';

	let { campaignId }: { campaignId: Id<'campaigns'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	/**
	 * Which checklist is being edited. A campaign keeps one active version of
	 * EACH — the record checklist it always had, and the trip checklist that
	 * feeds a trip's Checklist tab (PLAN-trips.md §6). Without this switch the
	 * trip list is unauthorable and a trip's checklist stays empty forever.
	 */
	let scope = $state<TaskTemplateScope>('project');
	const isTrip = $derived(scope === 'trip');

	const templatesResponse = useQuery(api.taskTemplates.queries.listTaskTemplates, () =>
		auth.isAuthenticated ? { campaignId, scope } : 'skip'
	);
	// The query reads an isActive index, so the rows arrive grouped by flag rather
	// than by age; newest first is what a version history should read as.
	const templates = $derived(
		[...((templatesResponse.data ?? []) as TaskTemplate[])].sort(
			(a, b) => b._creationTime - a._creationTime
		)
	);
	const isLoading = $derived(templatesResponse.isLoading);

	// Where each tag's stat shows. Read once for the tab and looked up per row —
	// the tag is the stat, so every row carrying it reports the same thing.
	const tagsResponse = useQuery(api.taskTemplates.queries.listImpactTags, () =>
		auth.isAuthenticated ? { campaignId } : 'skip'
	);
	const surfacesByTag = $derived(
		new Map(
			(tagsResponse.data ?? []).map((entry) => [
				entry.tag,
				{ showOnPublic: entry.showOnPublic, showOnDashboard: entry.showOnDashboard }
			])
		)
	);

	let dialogOpen = $state(false);
	let activatingId = $state<string | null>(null);
	// Null opens the dialog on "new version"; a template opens it on that one.
	let editing = $state<TaskTemplate | null>(null);

	function openNew(): void {
		editing = null;
		dialogOpen = true;
	}

	function openEdit(template: TaskTemplate): void {
		editing = template;
		dialogOpen = true;
	}

	function sortedItems(template: TaskTemplate): TaskTemplateItem[] {
		return [...template.items].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
	}

	/**
	 * A tagged item only publishes a count when its TAG's stat is set to show on
	 * the public site, so that is what the version-level warning keys off.
	 */
	function publishesACount(template: TaskTemplate): boolean {
		return template.items.some(
			(item) => item.impactTag && surfacesByTag.get(item.impactTag)?.showOnPublic
		);
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
		<Alert.Description>{m.settings_taskAppendOnlyNote()}</Alert.Description>
	</Alert.Root>

	<!--
		Two checklists, switched here rather than merged into one list: they are
		different work with different rules, and the one-active-version rule is
		per scope, so showing both at once would make "Active" ambiguous.
	-->
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div class="bg-muted inline-flex rounded-md p-1">
			<Button
				variant={isTrip ? 'ghost' : 'secondary'}
				size="sm"
				aria-pressed={!isTrip}
				onclick={() => (scope = 'project')}
			>
				{m.settings_scopeRecordChecklist()}
			</Button>
			<Button
				variant={isTrip ? 'secondary' : 'ghost'}
				size="sm"
				aria-pressed={isTrip}
				onclick={() => (scope = 'trip')}
			>
				{m.settings_scopeTripChecklist()}
			</Button>
		</div>
		<Button onclick={openNew}>
			<PlusIcon />
			{m.settings_versionNew()}
		</Button>
	</div>

	{#if isTrip}
		<p class="text-muted-foreground text-xs">{m.settings_scopeTripHelp()}</p>
	{/if}

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
				<Button onclick={openNew}>
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
						{#if publishesACount(template)}
							<!-- Same wording an admin meets on a public custom field. -->
							<Card.Description>{m.settings_taskPublicWarning()}</Card.Description>
						{/if}
						<Card.Action>
							<div class="flex items-center gap-2">
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
								<Button variant="ghost" size="sm" onclick={() => openEdit(template)}>
									<PencilIcon />
									{m.action_edit()}
								</Button>
							</div>
						</Card.Action>
					</Card.Header>
					<Card.Content>
						{#if template.items.length === 0}
							<EmptyState size="sm" variant="plain" title={m.state_empty()} />
						{:else}
							<Table.Root>
								<Table.Header class="bg-muted">
									<Table.Row>
										<Table.Head class="w-16">{m.settings_stageOrder()}</Table.Head>
										<Table.Head>{m.settings_taskItemKey()}</Table.Head>
										<Table.Head>{m.settings_taskItemLabel()}</Table.Head>
										<Table.Head>{m.settings_impactTag()}</Table.Head>
										<Table.Head>{m.campaignStats_onPublic()}</Table.Head>
										<Table.Head>{m.campaignStats_onDashboard()}</Table.Head>
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
													<Badge variant="secondary">{item.impactTag}</Badge>
												{:else}
													<span class="text-muted-foreground">—</span>
												{/if}
											</Table.Cell>
											<Table.Cell>
												<!--
													The same badge ProjectFields puts on a public custom
													field, so "published" reads the same wherever an
													admin meets it. An untagged item has no stat to
													place, so it shows nothing either way.
												-->
												{#if item.impactTag && surfacesByTag.get(item.impactTag)?.showOnPublic}
													<Badge variant="warning" class="gap-1">
														<EyeIcon class="size-3" aria-hidden="true" />
														{m.settings_fieldPublic()}
													</Badge>
												{:else}
													<span class="text-muted-foreground">—</span>
												{/if}
											</Table.Cell>
											<Table.Cell>
												{#if item.impactTag && surfacesByTag.get(item.impactTag)?.showOnDashboard}
													<Badge variant="secondary" class="gap-1">
														<GaugeIcon class="size-3" aria-hidden="true" />
														{m.campaignStats_onDashboard()}
													</Badge>
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

<TaskTemplateVersionDialog bind:open={dialogOpen} {campaignId} template={editing} {scope} />
