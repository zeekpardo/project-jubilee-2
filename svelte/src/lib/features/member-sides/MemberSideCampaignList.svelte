<script lang="ts">
	// The picker. §13 corrects one campaign at a time, on purpose: the whole
	// point is that someone reads the before/after for the numbers THIS campaign
	// publishes before deciding, and an "apply everywhere" button would be the
	// silent rewrite the plan refuses.
	//
	// Only campaigns with something to review are listed — the query omits the
	// rest — so an empty list is the report saying there is nothing to do.
	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { cn } from '$lib/primitives/utils';
	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	type CampaignRow = {
		campaignId: Id<'campaigns'>;
		campaignName: string;
		campaignIsPublished: boolean;
		suspectCount: number;
	};

	let {
		campaigns,
		selectedId,
		onSelect
	}: {
		campaigns: CampaignRow[];
		selectedId: Id<'campaigns'> | null;
		onSelect: (campaignId: Id<'campaigns'>) => void;
	} = $props();
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.memberSides_campaigns()}</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-1">
		{#each campaigns as campaign (campaign.campaignId)}
			<button
				type="button"
				class={cn(
					'hover:bg-muted flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
					campaign.campaignId === selectedId && 'bg-muted font-medium'
				)}
				aria-current={campaign.campaignId === selectedId ? 'true' : undefined}
				onclick={() => onSelect(campaign.campaignId)}
			>
				<span class="min-w-0 truncate">
					{campaign.campaignName}
					<!-- An unpublished campaign's stats reach nobody yet, which changes
					     how urgent this is rather than whether it is worth fixing. -->
					{#if campaign.campaignIsPublished}
						<Badge variant="secondary" class="ml-1">{m.memberSides_published()}</Badge>
					{/if}
				</span>
				<Badge variant="outline" class="shrink-0">
					{m.memberSides_suspectCount({ count: campaign.suspectCount })}
				</Badge>
			</button>
		{/each}
	</Card.Content>
</Card.Root>
