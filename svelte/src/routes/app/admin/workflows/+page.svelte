<script lang="ts">
	// Every configured agent in the org, and what starts it.
	//
	// Org-wide rather than per-campaign: a workflow names a campaign but does
	// not live inside one, so a campaign with no workflow does not carry a dead
	// tab. See PLAN-workflows.md §6.

	// Shell
	import PageContainer from '$lib/shell/PageContainer.svelte';
	// Access
	import { getAccessContext } from '$lib/access';
	// Primitives
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import BotMessageSquareIcon from '@lucide/svelte/icons/bot-message-square';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	// Feature
	import WorkflowsTable from '$lib/features/workflows/WorkflowsTable.svelte';
	import NewWorkflowDialog from '$lib/features/workflows/NewWorkflowDialog.svelte';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();

	// The same bar the prompts surface sat behind: what a machine says to a
	// family on the charity's behalf is an org-level decision, not a campaign
	// manager's.
	const allowed = $derived(access.can('settings:manage'));

	const workflowsResponse = useQuery(api.workflows.queries.listWorkflows, () =>
		auth.isAuthenticated && allowed ? {} : 'skip'
	);
	const workflows = $derived(workflowsResponse.data ?? []);

	// Only for naming the campaign column and filling the create picker — the
	// workflow row carries an id and a list of ids is not a list anyone reads.
	const campaignsResponse = useQuery(api.campaigns.queries.listCampaigns, () =>
		auth.isAuthenticated && allowed ? {} : 'skip'
	);
	const campaigns = $derived(campaignsResponse.data ?? []);

	let newOpen = $state(false);
</script>

<PageContainer
	title={m.workflows_title()}
	description={m.workflows_subtitle()}
	access={allowed}
	loading={workflowsResponse.isLoading}
>
	{#snippet action()}
		<Button onclick={() => (newOpen = true)} disabled={campaigns.length === 0}>
			<PlusIcon />
			{m.workflows_new()}
		</Button>
	{/snippet}

	{#if workflows.length === 0}
		<EmptyState title={m.workflows_empty()} description={m.workflows_emptyBody()}>
			{#snippet icon()}
				<BotMessageSquareIcon />
			{/snippet}
			{#snippet action()}
				<!-- A workflow has to belong to a campaign, so with no campaigns the
				     honest thing is to say so rather than open a dialog whose only
				     required field cannot be filled. -->
				{#if campaigns.length === 0}
					<p class="text-muted-foreground text-sm">{m.workflows_needCampaign()}</p>
				{:else}
					<Button onclick={() => (newOpen = true)}>
						<PlusIcon />
						{m.workflows_new()}
					</Button>
				{/if}
			{/snippet}
		</EmptyState>
	{:else}
		<WorkflowsTable {workflows} {campaigns} />
	{/if}
</PageContainer>

<NewWorkflowDialog bind:open={newOpen} {campaigns} />
