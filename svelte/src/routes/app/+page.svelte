<script lang="ts">
	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import * as Card from '$lib/primitives/ui/card';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import * as m from '$lib/i18n/messages';

	const access = getAccessContext();
	const active = getActiveCampaignContext();

	const tiles = $derived([
		{ key: 'projects', label: active.objectLabelPlural, value: '—' },
		{ key: 'goalMet', label: m.dash_goalMet(), value: '—' },
		{ key: 'people', label: m.dash_people(), value: '—' },
		{ key: 'raised', label: m.dash_raised(), value: '—' }
	]);
</script>

<PageContainer title={m.dash_title()} description={m.dash_subtitle()}>
	{#if !active.current}
		<EmptyState
			title={access.isTeamLeader ? m.access_noCampaignsTitle() : m.shell_noCampaigns()}
			description={access.isTeamLeader ? m.access_noCampaignsBody() : ''}
		/>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{#each tiles as tile (tile.key)}
				<Card.Root>
					<Card.Header>
						<Card.Description>{tile.label}</Card.Description>
						<Card.Title class="text-3xl tabular-nums">{tile.value}</Card.Title>
					</Card.Header>
				</Card.Root>
			{/each}
		</div>
	{/if}
</PageContainer>
