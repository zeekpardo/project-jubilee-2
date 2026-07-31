<script lang="ts">
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext, Can } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import { formatCents, formatCentsCompact } from '$lib/features/money/format';
	import { transactionTypeLabel } from '$lib/features/money/labels';
	import TransactionFormDialog from '$lib/features/money/TransactionFormDialog.svelte';
	import DeleteTransactionDialog from '$lib/features/money/DeleteTransactionDialog.svelte';
	import AllocationPanel from '$lib/features/money/AllocationPanel.svelte';
	import type { Transaction, TransactionType } from '$lib/features/money/types';
	import * as m from '$lib/i18n/messages';

	import * as Card from '$lib/primitives/ui/card';
	import * as Table from '$lib/primitives/ui/table';
	import * as Tabs from '$lib/primitives/ui/tabs';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();
	const active = getActiveCampaignContext();

	const canRead = $derived(access.can('money:read', active.id));
	const canWrite = $derived(access.can('money:write', active.id));
	const canReadContacts = $derived(access.can('contacts:read'));

	const reconciliationResponse = useQuery(api.transactions.queries.getReconciliation, () =>
		auth.isAuthenticated && canRead ? {} : 'skip'
	);
	const reconciliation = $derived(reconciliationResponse?.data);

	const transactionsResponse = useQuery(api.transactions.queries.listTransactions, () =>
		auth.isAuthenticated && canRead ? {} : 'skip'
	);
	const transactions = $derived(transactionsResponse?.data ?? []);
	const loading = $derived(transactionsResponse?.isLoading ?? false);

	const unallocatedResponse = useQuery(api.transactions.queries.listUnallocated, () =>
		auth.isAuthenticated && canRead ? {} : 'skip'
	);
	const unallocated = $derived(unallocatedResponse?.data ?? []);
	const unallocatedLoading = $derived(unallocatedResponse?.isLoading ?? false);
	const remainingById = $derived(
		new Map<string, number>(unallocated.map((row) => [row._id as string, row.remainingCents]))
	);

	const contactsResponse = useQuery(api.contacts.queries.listContacts, () =>
		auth.isAuthenticated && canReadContacts ? {} : 'skip'
	);
	const contacts = $derived(contactsResponse?.data ?? []);
	const donorNames = $derived(
		new Map<string, string>(
			contacts.map((contact) => [contact._id as string, contactDisplayName(contact)])
		)
	);

	const LEDGER_TABS = [
		{ value: 'donation', label: () => m.money_donations() },
		{ value: 'transfer', label: () => m.money_transfers() },
		{ value: 'expenditure', label: () => m.money_expenditures() }
	] as const;

	let tab = $state<string>('donation');

	const tiles = $derived([
		{ key: 'received', label: m.money_received(), value: reconciliation?.receivedCents ?? 0 },
		{ key: 'sent', label: m.money_sent(), value: reconciliation?.sentCents ?? 0 },
		{ key: 'spent', label: m.money_spent(), value: reconciliation?.spentCents ?? 0 }
	]);

	function rowsFor(type: string) {
		return transactions.filter((transaction) => transaction.type === type);
	}

	let formOpen = $state(false);
	let editing = $state<Transaction | null>(null);
	let deleteOpen = $state(false);
	let deleting = $state<Transaction | null>(null);
	let allocateOpen = $state(false);
	let allocatingId = $state<string | null>(null);

	// Read back out of the live list so an amount edit made while the panel is
	// open moves the remainder the panel is computing against.
	const allocating = $derived(
		transactions.find((transaction) => transaction._id === allocatingId) ?? null
	);

	const defaultType = $derived(
		tab === 'unallocated' ? ('donation' as TransactionType) : (tab as TransactionType)
	);

	function openCreate(): void {
		editing = null;
		formOpen = true;
	}

	function openEdit(transaction: Transaction): void {
		editing = transaction;
		formOpen = true;
	}

	function openDelete(transaction: Transaction): void {
		deleting = transaction;
		deleteOpen = true;
	}

	function openAllocate(transaction: Transaction): void {
		allocatingId = transaction._id;
		allocateOpen = true;
	}
</script>

<PageContainer title={m.money_title()} description={m.money_subtitle()} access={canRead}>
	{#snippet action()}
		<Can do="money:write" campaignId={active.id}>
			<Button onclick={openCreate}>{m.money_newTransaction()}</Button>
		</Can>
	{/snippet}

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

	<Tabs.Root bind:value={tab}>
		<Tabs.List>
			{#each LEDGER_TABS as ledgerTab (ledgerTab.value)}
				<Tabs.Trigger value={ledgerTab.value}>{ledgerTab.label()}</Tabs.Trigger>
			{/each}
			<Tabs.Trigger value="unallocated">{m.money_unallocated()}</Tabs.Trigger>
		</Tabs.List>

		{#each LEDGER_TABS as ledgerTab (ledgerTab.value)}
			<Tabs.Content value={ledgerTab.value}>
				{#if loading}
					<div class="flex flex-col gap-2 pt-2">
						<Skeleton class="h-10 w-full" />
						<Skeleton class="h-10 w-full" />
					</div>
				{:else if rowsFor(ledgerTab.value).length === 0}
					<EmptyState title={m.money_empty()} />
				{:else}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>{m.field_date()}</Table.Head>
								<Table.Head>{m.field_amount()}</Table.Head>
								{#if ledgerTab.value === 'donation'}
									<Table.Head>{m.money_donor()}</Table.Head>
								{/if}
								<Table.Head>{m.field_notes()}</Table.Head>
								<Table.Head>{m.money_remaining()}</Table.Head>
								<Table.Head class="text-right">{m.field_actions()}</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each rowsFor(ledgerTab.value) as transaction (transaction._id)}
								<Table.Row>
									<Table.Cell class="text-muted-foreground">
										{transaction.occurredOn || '—'}
									</Table.Cell>
									<Table.Cell class="font-medium tabular-nums">
										{formatCents(transaction.amountCents)}
									</Table.Cell>
									{#if ledgerTab.value === 'donation'}
										<Table.Cell class="text-muted-foreground">
											{transaction.contactId
												? (donorNames.get(transaction.contactId) ?? m.money_noDonor())
												: m.money_noDonor()}
										</Table.Cell>
									{/if}
									<Table.Cell class="text-muted-foreground">
										{transaction.reference || transaction.note || '—'}
									</Table.Cell>
									<Table.Cell class="tabular-nums">
										{#if remainingById.has(transaction._id)}
											<Badge variant="warning">
												{formatCents(remainingById.get(transaction._id) ?? 0)}
											</Badge>
										{:else}
											<Badge variant="success">{m.money_fullyAllocated()}</Badge>
										{/if}
									</Table.Cell>
									<Table.Cell class="text-right">
										<div class="flex items-center justify-end gap-1">
											<Button size="sm" variant="outline" onclick={() => openAllocate(transaction)}>
												{m.money_allocate()}
											</Button>
											<Can do="money:write" campaignId={active.id}>
												<Button
													size="sm"
													variant="ghost"
													aria-label={m.action_edit()}
													onclick={() => openEdit(transaction)}
												>
													<PencilIcon class="size-4" />
												</Button>
												<Button
													size="sm"
													variant="ghost"
													aria-label={m.money_deleteTransaction()}
													onclick={() => openDelete(transaction)}
												>
													<Trash2Icon class="size-4" />
												</Button>
											</Can>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}
			</Tabs.Content>
		{/each}

		<Tabs.Content value="unallocated">
			{#if unallocatedLoading}
				<div class="flex flex-col gap-2 pt-2">
					<Skeleton class="h-10 w-full" />
					<Skeleton class="h-10 w-full" />
				</div>
			{:else if unallocated.length === 0}
				<EmptyState title={m.money_fullyAllocated()} />
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>{m.field_date()}</Table.Head>
							<Table.Head>{m.field_type()}</Table.Head>
							<Table.Head>{m.field_amount()}</Table.Head>
							<Table.Head>{m.money_remaining()}</Table.Head>
							<Table.Head class="text-right">{m.field_actions()}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each unallocated as transaction (transaction._id)}
							<Table.Row>
								<Table.Cell class="text-muted-foreground">
									{transaction.occurredOn || '—'}
								</Table.Cell>
								<Table.Cell>
									<Badge variant="secondary">{transactionTypeLabel(transaction.type)}</Badge>
								</Table.Cell>
								<Table.Cell class="font-medium tabular-nums">
									{formatCents(transaction.amountCents)}
								</Table.Cell>
								<Table.Cell class="tabular-nums">
									<Badge variant="warning">{formatCents(transaction.remainingCents)}</Badge>
								</Table.Cell>
								<Table.Cell class="text-right">
									<Button size="sm" variant="outline" onclick={() => openAllocate(transaction)}>
										{m.money_allocate()}
									</Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		</Tabs.Content>
	</Tabs.Root>
</PageContainer>

<TransactionFormDialog bind:open={formOpen} {defaultType} transaction={editing} donors={contacts} />

<DeleteTransactionDialog bind:open={deleteOpen} transaction={deleting} />

<AllocationPanel
	bind:open={allocateOpen}
	transaction={allocating}
	campaigns={active.campaigns}
	defaultCampaignId={active.id}
	{canWrite}
/>
