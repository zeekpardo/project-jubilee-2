<script lang="ts">
	// Shell
	import { resolve } from '$app/paths';
	// Primitives
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';

	import type { CampaignOption, WorkflowRow } from './types';
	import { triggerSummary, workflowStatusLabel, workflowStatusVariant } from './labels';
	import * as m from '$lib/i18n/messages';

	let {
		workflows,
		campaigns
	}: {
		workflows: WorkflowRow[];
		campaigns: CampaignOption[];
	} = $props();

	// A map rather than a find per row: the list is small today and this is
	// cheap either way, but the campaign name is read once per row and the
	// lookup is the only reason the campaigns query is here at all.
	const campaignNames = $derived(
		new Map(campaigns.map((campaign) => [campaign._id, campaign.name]))
	);
</script>

<div class="overflow-hidden rounded-lg border">
	<Table.Root>
		<Table.Header class="bg-muted">
			<Table.Row>
				<Table.Head>{m.field_name()}</Table.Head>
				<Table.Head>{m.workflows_campaign()}</Table.Head>
				<Table.Head>{m.workflows_trigger()}</Table.Head>
				<Table.Head>{m.field_status()}</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each workflows as workflow (workflow._id)}
				<!--
					The whole row navigates, and it does it through ONE real link
					stretched over the row rather than a click handler on the `<tr>`.
					A row that only responds to a mouse is a row a keyboard cannot
					open, and a `<tr onclick>` with a bolted-on role would be lying
					about what it is.
				-->
				<Table.Row class="hover:bg-muted/50 relative cursor-pointer">
					<Table.Cell class="font-medium">
						<a
							class="after:absolute after:inset-0 hover:underline focus-visible:underline"
							href={resolve('/app/admin/workflows/[id]', { id: workflow._id })}
						>
							{workflow.name}
						</a>
					</Table.Cell>
					<Table.Cell class="text-muted-foreground">
						{campaignNames.get(workflow.campaignId) ?? m.workflows_campaignUnknown()}
					</Table.Cell>
					<Table.Cell class="text-muted-foreground">{triggerSummary(workflow.trigger)}</Table.Cell>
					<Table.Cell>
						<!--
							Status carries publication on its own. There is deliberately no
							version-count column: `listWorkflows` returns the document, which
							holds a pointer to the current version and not a count of them,
							and a per-row count would be one extra query per row to say
							something the badge beside it already says.
						-->
						<Badge variant={workflowStatusVariant(workflow.status)}>
							{workflowStatusLabel(workflow.status)}
						</Badge>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
