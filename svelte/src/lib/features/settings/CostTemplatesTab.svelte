<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import * as Table from '$lib/primitives/ui/table';
	import * as Alert from '$lib/primitives/ui/alert';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import InfoIcon from '@lucide/svelte/icons/info';
	import CoinsIcon from '@lucide/svelte/icons/coins';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import CostTemplateVersionDialog from './CostTemplateVersionDialog.svelte';
	import { sumCents } from './amount';
	import { formatCents } from '$lib/features/money/format';
	import type { CostTemplate } from './types';
	import * as m from '$lib/i18n/messages';

	let { campaignId }: { campaignId: Id<'campaigns'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();

	const templatesResponse = useQuery(api.costTemplates.queries.listCostTemplates, () =>
		auth.isAuthenticated ? { campaignId } : 'skip'
	);
	// The query already returns newest first, which is the order a rate card is read in.
	const templates = $derived((templatesResponse.data ?? []) as CostTemplate[]);
	const isLoading = $derived(templatesResponse.isLoading);

	let dialogOpen = $state(false);

	function lineItemRows(template: CostTemplate): [string, number][] {
		return Object.entries(template.lineItems).sort(([a], [b]) => a.localeCompare(b));
	}
</script>

<div class="flex flex-col gap-4">
	<Alert.Root>
		<InfoIcon class="size-4" />
		<Alert.Description>{m.settings_appendOnlyNote()}</Alert.Description>
	</Alert.Root>

	<div class="flex justify-end">
		<Button onclick={() => (dialogOpen = true)}>
			<PlusIcon />
			{m.settings_versionNew()}
		</Button>
	</div>

	{#if isLoading}
		<div class="flex flex-col gap-3">
			<Skeleton class="h-40 w-full" />
			<Skeleton class="h-40 w-full" />
		</div>
	{:else if templates.length === 0}
		<EmptyState title={m.settings_costEmpty()}>
			{#snippet icon()}
				<CoinsIcon />
			{/snippet}
			{#snippet action()}
				<Button onclick={() => (dialogOpen = true)}>
					<PlusIcon />
					{m.settings_versionNew()}
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="flex flex-col gap-4">
			{#each templates as template, index (template._id)}
				<Card.Root>
					<Card.Header>
						<Card.Title>{m.settings_version()} {template.version}</Card.Title>
						{#if template.effectiveFrom}
							<Card.Description>
								{m.settings_effectiveFrom()}: {template.effectiveFrom}
							</Card.Description>
						{/if}
						{#if index === 0}
							<Card.Action>
								<Badge>{m.settings_latest()}</Badge>
							</Card.Action>
						{/if}
					</Card.Header>
					<Card.Content>
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>{m.settings_lineItemKey()}</Table.Head>
									<Table.Head class="text-right">{m.settings_lineItemAmount()}</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each lineItemRows(template) as [key, amountCents] (key)}
									<Table.Row>
										<Table.Cell class="font-mono text-xs">{key}</Table.Cell>
										<Table.Cell class="text-right font-medium tabular-nums">
											{formatCents(amountCents)}
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
							<Table.Footer>
								<Table.Row>
									<Table.Cell class="font-medium">{m.settings_total()}</Table.Cell>
									<Table.Cell class="text-right font-medium tabular-nums">
										{formatCents(sumCents(template.lineItems))}
									</Table.Cell>
								</Table.Row>
							</Table.Footer>
						</Table.Root>
					</Card.Content>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>

<CostTemplateVersionDialog bind:open={dialogOpen} {campaignId} />
