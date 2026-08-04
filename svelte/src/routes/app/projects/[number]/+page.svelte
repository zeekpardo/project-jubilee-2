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
	import ProjectChecklist from '$lib/features/projects/ProjectChecklist.svelte';
	import ProjectFields from '$lib/features/projects/ProjectFields.svelte';
	import ProjectDocuments from '$lib/features/projects/ProjectDocuments.svelte';
	import ProjectHero from '$lib/features/projects/ProjectHero.svelte';
	import ProjectMembers from '$lib/features/projects/ProjectMembers.svelte';
	import ProjectOverview from '$lib/features/projects/ProjectOverview.svelte';
	import ProjectGiving from '$lib/features/projects/ProjectGiving.svelte';
	import ProjectInternalPanel from '$lib/features/projects/ProjectInternalPanel.svelte';
	import ProjectPublicPanel from '$lib/features/projects/ProjectPublicPanel.svelte';
	import UpdatesPanel from '$lib/features/updates/UpdatesPanel.svelte';
	import EditProjectDialog from '$lib/features/projects/EditProjectDialog.svelte';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import { Button } from '$lib/primitives/ui/button';
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
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

	// The open tab lives in the URL so a record can be LINKED to a particular
	// one — the task list points at ?tab=checklist. Without this the page always
	// opened on Overview and the link landed a click short of what it promised.
	const TAB_VALUES = [
		'overview',
		'details',
		'checklist',
		'people',
		'budget',
		'documents',
		'updates',
		'giving',
		'public',
		'internal'
	];

	const activeTab = $derived.by(() => {
		const requested = page.url.searchParams.get('tab');
		// An unknown tab falls back rather than rendering an empty panel: this
		// value arrives from a hand-editable URL and a stale bookmark.
		return requested && TAB_VALUES.includes(requested) ? requested : 'overview';
	});

	function selectTab(value: string): void {
		if (value === activeTab) return;
		const query = value === 'overview' ? '' : `?tab=${value}`;
		void goto(resolve(`${page.url.pathname}${query}` as Pathname), {
			// Switching a tab is not a navigation someone wants to walk back
			// through, and the page must not jump to the top under the tab strip.
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

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

			<Tabs.Root
				value={activeTab}
				onValueChange={(details: { value: string }) => selectTab(details.value)}
				class="gap-6"
			>
				<Tabs.List>
					<Tabs.Trigger value="overview">{m.nav_section_overview()}</Tabs.Trigger>
					<Tabs.Trigger value="details">{m.projectDetail_details()}</Tabs.Trigger>
					<Tabs.Trigger value="checklist">{m.tasks_title()}</Tabs.Trigger>
					<Tabs.Trigger value="people">{m.projects_members()}</Tabs.Trigger>
					<Tabs.Trigger value="budget">{m.nav_budget()}</Tabs.Trigger>
					<Tabs.Trigger value="documents">{m.projects_documents()}</Tabs.Trigger>
					<Tabs.Trigger value="updates">{m.updates_title()}</Tabs.Trigger>
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

				<Tabs.Content value="checklist">
					<ProjectChecklist {project} />
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

				<Tabs.Content value="updates">
					<!-- The same panel the campaign screen mounts, told which record
					these posts are about. Writing one is `projects:write`, the same
					capability that authorizes this record's own story; publishing it is
					not, and the panel says so. -->
					<UpdatesPanel {campaignId} projectId={project._id} />
				</Tabs.Content>

				<Tabs.Content value="giving">
					<ProjectGiving projectId={project._id} {campaignId} canRead={canReadMoney} />
				</Tabs.Content>

				<Tabs.Content value="public">
					<ProjectPublicPanel
						projectId={project._id}
						number={project.number}
						campaignSlug={campaign?.slug ?? ''}
						objectSlug={campaign?.objectSlug ?? ''}
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
