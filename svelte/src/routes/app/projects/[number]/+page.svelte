<script lang="ts">
	import { page } from '$app/state';
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import * as Card from '$lib/primitives/ui/card';
	import * as Tabs from '$lib/primitives/ui/tabs';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import ProjectBudget from '$lib/features/projects/ProjectBudget.svelte';
	import ProjectDocuments from '$lib/features/projects/ProjectDocuments.svelte';
	import ProjectHeader from '$lib/features/projects/ProjectHeader.svelte';
	import ProjectMembers from '$lib/features/projects/ProjectMembers.svelte';
	import ProjectOverview from '$lib/features/projects/ProjectOverview.svelte';
	import ProjectProgress from '$lib/features/projects/ProjectProgress.svelte';
	import { toStages } from '$lib/features/projects/stages';
	import { useProjectMoney } from '$lib/features/projects/money.svelte';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();

	const number = $derived(page.params.number ?? '');

	const projectResponse = useQuery(api.projects.queries.getProjectByNumber, () =>
		auth.isAuthenticated && number ? { number } : 'skip'
	);
	const project = $derived(projectResponse.data ?? null);
	const campaignId = $derived(project?.campaignId ?? null);

	const campaignResponse = useQuery(api.campaigns.queries.getCampaign, () =>
		campaignId ? { campaignId } : 'skip'
	);
	const campaign = $derived(campaignResponse.data ?? null);

	const stagesResponse = useQuery(api.pipelineStages.queries.listStages, () =>
		campaignId ? { campaignId } : 'skip'
	);
	const stages = $derived(toStages(stagesResponse.data));

	const money = useProjectMoney(() => project?._id ?? null);

	const allowed = $derived(access.can('projects:read', campaignId));
	const canWrite = $derived(access.can('projects:write', campaignId));
</script>

<PageContainer access={project ? allowed : true} loading={projectResponse.isLoading}>
	{#if !project || !campaignId}
		<EmptyState title={m.projects_notFound()} />
	{:else}
		<div class="flex flex-col gap-6">
			<ProjectHeader
				{project}
				{stages}
				goalLabel={campaign?.goalLabel ?? m.projects_goalMet()}
				canWrite={allowed && canWrite}
			/>

			<Card.Root>
				<Card.Header>
					<Card.Title>{m.projects_progress()}</Card.Title>
				</Card.Header>
				<Card.Content>
					<ProjectProgress
						raisedCents={money.raisedCents}
						targetCents={money.targetCents}
						showAmounts
					/>
				</Card.Content>
			</Card.Root>

			<Tabs.Root value="overview" class="gap-6">
				<Tabs.List>
					<Tabs.Trigger value="overview">{m.nav_section_overview()}</Tabs.Trigger>
					<Tabs.Trigger value="people">{m.projects_members()}</Tabs.Trigger>
					<Tabs.Trigger value="budget">{m.nav_budget()}</Tabs.Trigger>
					<Tabs.Trigger value="documents">{m.projects_documents()}</Tabs.Trigger>
				</Tabs.List>

				<Tabs.Content value="overview">
					<ProjectOverview {project} />
				</Tabs.Content>

				<Tabs.Content value="people">
					<ProjectMembers {project} />
				</Tabs.Content>

				<Tabs.Content value="budget">
					<ProjectBudget {project} budget={money.budget} isLoading={money.isLoading} />
				</Tabs.Content>

				<Tabs.Content value="documents">
					<ProjectDocuments {project} {stages} />
				</Tabs.Content>
			</Tabs.Root>
		</div>
	{/if}
</PageContainer>
