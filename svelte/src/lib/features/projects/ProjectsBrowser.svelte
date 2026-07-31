<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import SearchIcon from '@lucide/svelte/icons/search';
	import TableIcon from '@lucide/svelte/icons/table';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Input } from '$lib/primitives/ui/input';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import * as Select from '$lib/primitives/ui/select';
	import * as Table from '$lib/primitives/ui/table';
	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';
	import ProjectCard from './ProjectCard.svelte';
	import ProjectRow from './ProjectRow.svelte';
	import { toStages } from './stages';

	let { campaignId }: { campaignId: Id<'campaigns'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();

	const ALL_STAGES = 'all';

	let search = $state('');
	let stageFilter = $state(ALL_STAGES);

	const view = $derived(page.url.searchParams.get('view') === 'gallery' ? 'gallery' : 'table');

	const stagesResponse = useQuery(api.pipelineStages.queries.listStages, () =>
		auth.isAuthenticated ? { campaignId } : 'skip'
	);
	const stages = $derived(toStages(stagesResponse.data));

	const projectsResponse = useQuery(api.projects.queries.listProjects, () =>
		auth.isAuthenticated
			? {
					campaignId,
					...(stageFilter === ALL_STAGES ? {} : { stage: stageFilter })
				}
			: 'skip'
	);

	const projects = $derived(projectsResponse.data ?? []);

	const filtered = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		const rows = needle
			? projects.filter(
					(project) =>
						project.name.toLowerCase().includes(needle) ||
						project.number.toLowerCase().includes(needle)
				)
			: projects;
		return [...rows].sort((a, b) => a.number.localeCompare(b.number));
	});

	const stageCollection = $derived(
		createListCollection({
			items: [
				{ value: ALL_STAGES, label: m.projects_allStages() },
				...stages.map((stage) => ({ value: stage.key, label: stage.label }))
			]
		})
	);
</script>

<div class="flex flex-col gap-4">
	<div
		role="toolbar"
		aria-orientation="horizontal"
		class="flex w-full items-start justify-between gap-2 p-1"
	>
		<div class="flex flex-1 flex-wrap items-center gap-2">
			<div class="relative">
				<SearchIcon
					class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
					aria-hidden="true"
				/>
				<Input
					bind:value={search}
					class="h-8 w-40 pl-9 lg:w-56"
					type="search"
					placeholder={m.list_search()}
					aria-label={m.list_search()}
				/>
			</div>

			<Select.Root
				collection={stageCollection}
				value={[stageFilter]}
				onValueChange={(details: { value: string[] }): void => {
					stageFilter = details.value[0] ?? ALL_STAGES;
				}}
			>
				<Select.Label class="sr-only">{m.projects_stage()}</Select.Label>
				<Select.Trigger size="sm" class="w-44" placeholder={m.projects_allStages()} />
				<Select.Content>
					{#each stageCollection.items as option (option.value)}
						<Select.Item item={option}>
							<Select.ItemText>{option.label}</Select.ItemText>
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		<div class="flex items-center gap-2">
			<div class="flex items-center gap-1 rounded-md border p-1">
				<Button
					size="sm"
					variant={view === 'table' ? 'secondary' : 'ghost'}
					href={resolve('/app/projects?view=table')}
					aria-current={view === 'table' ? 'page' : undefined}
					data-sveltekit-replacestate
					data-sveltekit-noscroll
				>
					<TableIcon aria-hidden="true" />
					{m.projects_viewTable()}
				</Button>
				<Button
					size="sm"
					variant={view === 'gallery' ? 'secondary' : 'ghost'}
					href={resolve('/app/projects?view=gallery')}
					aria-current={view === 'gallery' ? 'page' : undefined}
					data-sveltekit-replacestate
					data-sveltekit-noscroll
				>
					<LayoutGridIcon aria-hidden="true" />
					{m.projects_viewGallery()}
				</Button>
			</div>
		</div>
	</div>

	{#if projectsResponse.isLoading}
		<div class="flex flex-col gap-3">
			<Skeleton class="h-10 w-full" />
			<Skeleton class="h-10 w-full" />
			<Skeleton class="h-10 w-full" />
		</div>
	{:else if filtered.length === 0}
		<EmptyState
			title={projects.length === 0 ? m.projects_empty() : m.list_noResults()}
			description={projects.length === 0 ? m.projects_emptyBody() : undefined}
		/>
	{:else if view === 'gallery'}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{#each filtered as project (project._id)}
				<ProjectCard {project} {stages} />
			{/each}
		</div>
	{:else}
		<div class="overflow-hidden rounded-lg border">
			<Table.Root>
				<Table.Header class="bg-muted">
					<Table.Row>
						<Table.Head>{m.projects_number()}</Table.Head>
						<Table.Head>{m.field_name()}</Table.Head>
						<Table.Head>{m.projects_stage()}</Table.Head>
						<Table.Head class="text-right">{m.projects_target()}</Table.Head>
						<Table.Head class="text-right">{m.projects_raised()}</Table.Head>
						<Table.Head>{m.projects_progress()}</Table.Head>
						<Table.Head>{m.projects_published()}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each filtered as project (project._id)}
						<ProjectRow {project} {stages} />
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</div>
