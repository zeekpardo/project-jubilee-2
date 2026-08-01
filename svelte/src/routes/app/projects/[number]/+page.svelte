<script lang="ts">
	import { page } from '$app/state';
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { useCrumbTitle } from '$lib/shell/crumb-title.svelte';
	import { getAccessContext } from '$lib/access';
	import * as Tabs from '$lib/primitives/ui/tabs';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import ProjectBudget from '$lib/features/projects/ProjectBudget.svelte';
	import ProjectFields from '$lib/features/projects/ProjectFields.svelte';
	import ProjectDocuments from '$lib/features/projects/ProjectDocuments.svelte';
	import ProjectHero from '$lib/features/projects/ProjectHero.svelte';
	import ProjectMembers from '$lib/features/projects/ProjectMembers.svelte';
	import ProjectOverview from '$lib/features/projects/ProjectOverview.svelte';
	import ProjectGiving from '$lib/features/projects/ProjectGiving.svelte';
	import ProjectInternalPanel from '$lib/features/projects/ProjectInternalPanel.svelte';
	import ProjectPublicPanel from '$lib/features/projects/ProjectPublicPanel.svelte';
	import EditProjectDialog from '$lib/features/projects/EditProjectDialog.svelte';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import { Button } from '$lib/primitives/ui/button';
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
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

	useCrumbTitle(() => (project ? `${project.number} ${project.name}` : null));

	const money = useProjectMoney(() => project?._id ?? null);

	const allowed = $derived(access.can('projects:read', campaignId));
	const canWrite = $derived(access.can('projects:write', campaignId));
	const canReadMoney = $derived(access.can('money:read', campaignId));

	const settingsResponse = useQuery(api.orgSettings.queries.getOrgSettings, () =>
		auth.isAuthenticated ? {} : 'skip'
	);
	const orgSlug = $derived(settingsResponse.data?.slug ?? null);

	const client = useConvexClient();
	let editOpen = $state(false);
	let deleteOpen = $state(false);

	async function confirmDelete() {
		if (!project) return;
		await client.mutation(api.projects.mutations.deleteProject, { projectId: project._id });
		await goto(resolve('/app/projects'));
	}
</script>

<PageContainer access={project ? allowed : true} loading={projectResponse.isLoading}>
	{#snippet action()}
		{#if project && canWrite}
			<div class="flex items-center gap-2">
				<Button variant="outline" onclick={() => (editOpen = true)}>
					{m.projects_editDetails()}
				</Button>
				<Button variant="ghost" onclick={() => (deleteOpen = true)}>
					{m.projects_delete()}
				</Button>
			</div>
		{/if}
	{/snippet}

	{#if !project || !campaignId}
		<EmptyState title={m.projects_notFound()} />
	{:else}
		<div class="flex flex-col gap-6">
			<ProjectHero
				{project}
				{stages}
				goalLabel={campaign?.goalLabel ?? m.projects_goalMet()}
				raisedCents={money.raisedCents}
				targetCents={money.targetCents}
			/>

			<Tabs.Root value="overview" class="gap-6">
				<Tabs.List>
					<Tabs.Trigger value="overview">{m.nav_section_overview()}</Tabs.Trigger>
					<Tabs.Trigger value="details">{m.projectDetail_details()}</Tabs.Trigger>
					<Tabs.Trigger value="people">{m.projects_members()}</Tabs.Trigger>
					<Tabs.Trigger value="budget">{m.nav_budget()}</Tabs.Trigger>
					<Tabs.Trigger value="documents">{m.projects_documents()}</Tabs.Trigger>
					<Tabs.Trigger value="giving">{m.projectDetail_tab_giving()}</Tabs.Trigger>
					<Tabs.Trigger value="public">{m.projectDetail_tab_public()}</Tabs.Trigger>
					<Tabs.Trigger value="internal">{m.projectDetail_tab_internal()}</Tabs.Trigger>
				</Tabs.List>

				<Tabs.Content value="overview">
					<ProjectOverview {project} />
				</Tabs.Content>

				<Tabs.Content value="details">
					<ProjectFields {project} />
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

				<Tabs.Content value="giving">
					<ProjectGiving projectId={project._id} canRead={canReadMoney} />
				</Tabs.Content>

				<Tabs.Content value="public">
					<ProjectPublicPanel
						projectId={project._id}
						number={project.number}
						campaignSlug={campaign?.slug ?? ''}
						{orgSlug}
						isPublished={project.isPublished}
						publicName={project.publicName}
						videoUrl={project.videoUrl}
						{canWrite}
					/>
				</Tabs.Content>

				<Tabs.Content value="internal">
					<ProjectInternalPanel {project} {canWrite} />
				</Tabs.Content>
			</Tabs.Root>
		</div>
	{/if}
</PageContainer>

{#if project}
	<EditProjectDialog bind:open={editOpen} {project} />
	<ConfirmDialog
		bind:open={deleteOpen}
		title={m.projects_delete()}
		body={m.projects_deleteBody()}
		onConfirm={confirmDelete}
	/>
{/if}
