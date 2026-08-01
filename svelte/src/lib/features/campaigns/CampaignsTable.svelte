<script lang="ts">
	// Shell
	import { resolve } from '$app/paths';
	// Primitives
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	// Access
	import { Can } from '$lib/access';

	import type { Campaign } from './types';
	import * as m from '$lib/i18n/messages';

	let {
		campaigns,
		onEdit,
		onDelete
	}: {
		campaigns: Campaign[];
		onEdit: (campaign: Campaign) => void;
		onDelete: (campaign: Campaign) => void;
	} = $props();

	function statusLabel(status: Campaign['status']): string {
		if (status === 'active') return m.campaigns_status_active();
		if (status === 'paused') return m.campaigns_status_paused();
		return m.campaigns_status_archived();
	}

	function statusVariant(status: Campaign['status']): 'success' | 'warning' | 'secondary' {
		if (status === 'active') return 'success';
		if (status === 'paused') return 'warning';
		return 'secondary';
	}
</script>

<div class="overflow-hidden rounded-lg border">
	<Table.Root>
		<Table.Header class="bg-muted">
			<Table.Row>
				<Table.Head>{m.field_name()}</Table.Head>
				<Table.Head>{m.field_slug()}</Table.Head>
				<Table.Head>{m.field_status()}</Table.Head>
				<Table.Head>{m.campaigns_objectLabel()}</Table.Head>
				<Table.Head class="text-right">{m.field_actions()}</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each campaigns as campaign (campaign._id)}
				<Table.Row>
					<Table.Cell class="font-medium">
						<a
							class="hover:underline"
							href={resolve('/app/admin/campaigns/[id]', { id: campaign._id })}
						>
							{campaign.name}
						</a>
					</Table.Cell>
					<Table.Cell class="text-muted-foreground">{campaign.slug}</Table.Cell>
					<Table.Cell>
						<div class="flex flex-wrap items-center gap-1.5">
							<Badge variant={statusVariant(campaign.status)}>{statusLabel(campaign.status)}</Badge>
							<Badge variant={campaign.isPublished ? 'default' : 'outline'}>
								{campaign.isPublished ? m.campaigns_published() : m.campaigns_unpublished()}
							</Badge>
						</div>
					</Table.Cell>
					<Table.Cell class="text-muted-foreground">
						{campaign.objectLabel} / {campaign.objectLabelPlural}
					</Table.Cell>
					<Table.Cell>
						<div class="flex justify-end gap-1">
							<Can do="campaign:edit" campaignId={campaign._id}>
								<Button
									variant="ghost"
									size="icon"
									aria-label={m.campaigns_edit()}
									onclick={() => onEdit(campaign)}
								>
									<PencilIcon />
								</Button>
							</Can>
							<Can do="campaign:delete">
								<Button
									variant="ghost"
									size="icon"
									aria-label={m.campaigns_deleteTitle()}
									onclick={() => onDelete(campaign)}
								>
									<TrashIcon />
								</Button>
							</Can>
						</div>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
