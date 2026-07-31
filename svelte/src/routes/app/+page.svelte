<script lang="ts">
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import * as Card from '$lib/primitives/ui/card';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Progress } from '$lib/primitives/ui/progress';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import type { Id } from '$convex/_generated/dataModel';
	import { formatCents } from '$lib/features/projects/format';
	import { toStages } from '$lib/features/projects/stages';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();
	const active = getActiveCampaignContext();

	const campaignId = $derived(active.id as Id<'campaigns'> | null);
	const canReadProjects = $derived(access.can('projects:read', active.id));
	const canReadContacts = $derived(access.can('contacts:read', active.id));
	const canReadMoney = $derived(access.can('money:read', active.id));

	const projectsResponse = useQuery(api.projects.queries.listProjects, () =>
		auth.isAuthenticated && campaignId && canReadProjects ? { campaignId } : 'skip'
	);
	const projects = $derived(projectsResponse.data ?? []);

	const stagesResponse = useQuery(api.pipelineStages.queries.listStages, () =>
		auth.isAuthenticated && campaignId && canReadProjects ? { campaignId } : 'skip'
	);
	const stages = $derived(toStages(stagesResponse.data));

	const contactsResponse = useQuery(api.contacts.queries.listContacts, () =>
		auth.isAuthenticated && canReadContacts ? {} : 'skip'
	);

	const reconciliationResponse = useQuery(api.transactions.queries.getReconciliation, () =>
		auth.isAuthenticated && canReadMoney ? {} : 'skip'
	);

	const goalMetCount = $derived(projects.filter((project) => project.isGoalMet).length);

	const tiles = $derived([
		{
			key: 'records',
			label: active.objectLabelPlural,
			value: canReadProjects ? String(projects.length) : null
		},
		{
			key: 'goalMet',
			label: m.dash_goalMet(),
			value: canReadProjects ? String(goalMetCount) : null
		},
		{
			key: 'people',
			label: m.dash_people(),
			value: canReadContacts ? String(contactsResponse.data?.length ?? 0) : null
		},
		{
			key: 'raised',
			label: m.dash_raised(),
			value: canReadMoney ? formatCents(reconciliationResponse.data?.receivedCents ?? 0) : null
		}
	]);

	const pipeline = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const project of projects) {
			counts[project.stage] = (counts[project.stage] ?? 0) + 1;
		}
		const rows = stages.map((stage) => ({
			key: stage.key,
			label: stage.label,
			count: counts[stage.key] ?? 0
		}));
		const peak = rows.reduce((max, row) => Math.max(max, row.count), 0);
		return rows.map((row) => ({
			...row,
			percent: peak === 0 ? 0 : Math.round((row.count / peak) * 100)
		}));
	});
</script>

<PageContainer title={m.dash_title()} description={m.dash_subtitle()}>
	{#if !active.current}
		<EmptyState
			title={access.isTeamLeader ? m.access_noCampaignsTitle() : m.shell_noCampaigns()}
			description={access.isTeamLeader ? m.access_noCampaignsBody() : undefined}
		/>
	{:else}
		<!-- Tiles pick up a faint primary wash via `*:data-[slot=card]` rather than a
		     class on each card, so the gradient stays in one place. -->
		<div
			class="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-3 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs md:gap-4 lg:grid-cols-4"
		>
			{#each tiles as tile (tile.key)}
				<Card.Root class="@container/card">
					<Card.Header>
						<Card.Description>{tile.label}</Card.Description>
						<Card.Title class="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
							{#if tile.value === null}
								<span class="text-muted-foreground" aria-hidden="true">—</span>
							{:else}
								{tile.value}
							{/if}
						</Card.Title>
					</Card.Header>
				</Card.Root>
			{/each}
		</div>

		<Card.Root>
			<Card.Header>
				<Card.Title>{m.dash_pipeline()}</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if !canReadProjects}
					<EmptyState variant="plain" size="sm" title={m.access_deniedTitle()} />
				{:else if projectsResponse.isLoading || stagesResponse.isLoading}
					<div class="flex flex-col gap-3">
						<Skeleton class="h-6 w-full" />
						<Skeleton class="h-6 w-full" />
						<Skeleton class="h-6 w-full" />
					</div>
				{:else if pipeline.length === 0}
					<EmptyState variant="plain" size="sm" title={m.state_empty()} />
				{:else}
					<ul class="flex flex-col gap-4">
						{#each pipeline as stage (stage.key)}
							<li class="flex items-center gap-4">
								<span class="w-32 shrink-0 truncate text-sm">{stage.label}</span>
								<Progress value={stage.percent} class="flex-1" />
								<span class="w-8 text-right text-sm tabular-nums">{stage.count}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</PageContainer>
