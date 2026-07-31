<script lang="ts">
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { formatCents, formatCentsCompact } from '$lib/features/money/format';
	import * as m from '$lib/i18n/messages';

	import * as Card from '$lib/primitives/ui/card';
	import * as Table from '$lib/primitives/ui/table';
	import * as Tabs from '$lib/primitives/ui/tabs';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();
	const active = getActiveCampaignContext();

	const canRead = $derived(access.can('money:read', active.id));

	const reconciliationResponse = useQuery(api.transactions.queries.getReconciliation, () =>
		auth.isAuthenticated && canRead ? {} : 'skip'
	);
	const reconciliation = $derived(reconciliationResponse?.data);

	const transactionsResponse = useQuery(api.transactions.queries.listTransactions, () =>
		auth.isAuthenticated && canRead ? {} : 'skip'
	);
	const transactions = $derived(transactionsResponse?.data ?? []);
	const loading = $derived(transactionsResponse?.isLoading ?? false);

	const TABS = [
		{ value: 'donation', label: () => m.money_donations() },
		{ value: 'transfer', label: () => m.money_transfers() },
		{ value: 'expenditure', label: () => m.money_expenditures() }
	] as const;

	const tiles = $derived([
		{ key: 'received', label: m.money_received(), value: reconciliation?.receivedCents ?? 0 },
		{ key: 'sent', label: m.money_sent(), value: reconciliation?.sentCents ?? 0 },
		{ key: 'spent', label: m.money_spent(), value: reconciliation?.spentCents ?? 0 }
	]);

	function rowsFor(type: string) {
		return transactions.filter((t) => t.type === type);
	}
</script>

<PageContainer title={m.money_title()} description={m.money_subtitle()} access={canRead}>
	<div class="grid gap-4 sm:grid-cols-3">
		{#each tiles as tile (tile.key)}
			<Card.Root>
				<Card.Header>
					<Card.Description>{tile.label}</Card.Description>
					<Card.Title class="text-2xl tabular-nums">
						{formatCentsCompact(tile.value)}
					</Card.Title>
				</Card.Header>
			</Card.Root>
		{/each}
	</div>

	<Tabs.Root value="donation">
		<Tabs.List>
			{#each TABS as tab (tab.value)}
				<Tabs.Trigger value={tab.value}>{tab.label()}</Tabs.Trigger>
			{/each}
		</Tabs.List>

		{#each TABS as tab (tab.value)}
			<Tabs.Content value={tab.value}>
				{#if loading}
					<div class="flex flex-col gap-2 pt-2">
						<Skeleton class="h-10 w-full" />
						<Skeleton class="h-10 w-full" />
					</div>
				{:else if rowsFor(tab.value).length === 0}
					<EmptyState title={m.money_empty()} />
				{:else}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>{m.field_date()}</Table.Head>
								<Table.Head>{m.field_amount()}</Table.Head>
								<Table.Head>{m.field_type()}</Table.Head>
								<Table.Head>{m.field_notes()}</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each rowsFor(tab.value) as transaction (transaction._id)}
								<Table.Row>
									<Table.Cell class="text-muted-foreground">
										{transaction.occurredOn ?? '—'}
									</Table.Cell>
									<Table.Cell class="font-medium tabular-nums">
										{formatCents(transaction.amountCents)}
									</Table.Cell>
									<Table.Cell><Badge variant="secondary">{transaction.type}</Badge></Table.Cell>
									<Table.Cell class="text-muted-foreground">
										{transaction.reference ?? transaction.note ?? '—'}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}
			</Tabs.Content>
		{/each}
	</Tabs.Root>
</PageContainer>
