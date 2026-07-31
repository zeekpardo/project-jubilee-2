<script lang="ts">
	import { untrack } from 'svelte';

	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import * as Table from '$lib/primitives/ui/table';
	import * as Alert from '$lib/primitives/ui/alert';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Progress } from '$lib/primitives/ui/progress';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { createListCollection } from '@ark-ui/svelte/select';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import { dollarsToCents, centsToDollarInput } from '$lib/features/settings/amount';
	import type { CampaignSummary } from '$lib/campaigns/active.svelte';
	import { formatCents } from './format';
	import { remainingCents } from './remaining';
	import AmountField from './AmountField.svelte';
	import type { Allocation, Transaction } from './types';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	const CAMPAIGN_ONLY = '__none__';

	let {
		open = $bindable(false),
		transaction,
		campaigns = [],
		defaultCampaignId = null,
		canWrite = false
	}: {
		open?: boolean;
		transaction: Transaction | null;
		campaigns?: CampaignSummary[];
		defaultCampaignId?: string | null;
		canWrite?: boolean;
	} = $props();

	const allocationsResponse = useQuery(api.allocations.queries.listAllocationsForTransaction, () =>
		auth.isAuthenticated && transaction ? { transactionId: transaction._id } : 'skip'
	);
	const allocations = $derived(allocationsResponse.data ?? []);
	const isLoading = $derived(allocationsResponse.isLoading);

	// Every org project, so an allocation made against another campaign still
	// renders a name while the picker is filtered to the chosen campaign.
	const projectsResponse = useQuery(api.projects.queries.listProjects, () =>
		auth.isAuthenticated ? {} : 'skip'
	);
	const projects = $derived(projectsResponse.data ?? []);

	let editingId = $state<Id<'allocations'> | null>(null);
	let campaignId = $state('');
	let projectId = $state(CAMPAIGN_ONLY);
	let amount = $state('');
	let budgetItem = $state('');
	let isSaving = $state(false);
	let failure = $state<string | null>(null);
	let pendingRemoveId = $state<Id<'allocations'> | null>(null);
	let isRemoving = $state(false);

	function resetForm(): void {
		editingId = null;
		campaignId = defaultCampaignId ?? campaigns[0]?._id ?? '';
		projectId = CAMPAIGN_ONLY;
		amount = '';
		budgetItem = '';
		failure = null;
		pendingRemoveId = null;
	}

	$effect(() => {
		if (!open) return;
		// Opening resets the form; a later refresh of the campaign list must not
		// wipe what the user is halfway through typing.
		untrack(resetForm);
	});

	const editing = $derived(allocations.find((row) => row._id === editingId) ?? null);

	// The row being edited is excluded from the already-attributed sum: counting
	// its stored amount alongside its new one would reject a valid edit.
	const otherAllocations = $derived(allocations.filter((row) => row._id !== editingId));
	const availableCents = $derived(transaction ? remainingCents(transaction, otherAllocations) : 0);
	const unattributedCents = $derived(transaction ? remainingCents(transaction, allocations) : 0);
	const attributedPercent = $derived(
		transaction && transaction.amountCents > 0
			? ((transaction.amountCents - unattributedCents) / transaction.amountCents) * 100
			: 0
	);

	const amountCents = $derived(dollarsToCents(amount));
	const amountInvalid = $derived(
		amount.trim() !== '' && (amountCents === null || amountCents <= 0)
	);
	const overAllocated = $derived(amountCents !== null && amountCents > availableCents);
	const liveRemainingCents = $derived(availableCents - (amountCents ?? 0));
	const amountError = $derived(
		amountInvalid ? m.money_amountInvalid() : overAllocated ? m.money_overAllocated() : null
	);
	const canSubmit = $derived(
		amountCents !== null && amountCents > 0 && !overAllocated && campaignId !== ''
	);
	const formOpen = $derived(canWrite && (editing !== null || unattributedCents > 0));

	const campaignCollection = $derived(
		createListCollection({
			items: campaigns.map((campaign) => ({ value: campaign._id, label: campaign.name }))
		})
	);

	const takenProjectIds = $derived(
		new Set(otherAllocations.map((row) => row.projectId).filter(Boolean))
	);

	// updateAllocation has no way to unset a project, so campaign-level is only
	// offered where it is reachable: a new allocation, or one that is already
	// campaign-level.
	const projectItems = $derived([
		...(editing === null || editing.projectId === undefined
			? [{ value: CAMPAIGN_ONLY, label: m.money_allocationNone() }]
			: []),
		...projects
			.filter((project) => project.campaignId === campaignId && !takenProjectIds.has(project._id))
			.map((project) => ({ value: project._id as string, label: project.name }))
	]);
	const projectCollection = $derived(createListCollection({ items: projectItems }));

	function campaignName(id: string): string {
		return campaigns.find((campaign) => campaign._id === id)?.name ?? '—';
	}

	function projectName(id: Id<'projects'> | undefined): string {
		if (id === undefined) return m.money_allocationNone();
		return projects.find((project) => project._id === id)?.name ?? m.money_allocationNone();
	}

	function startEdit(allocation: Allocation): void {
		editingId = allocation._id;
		campaignId = allocation.campaignId;
		projectId = allocation.projectId ?? CAMPAIGN_ONLY;
		amount = centsToDollarInput(allocation.amountCents);
		budgetItem = allocation.budgetItem ?? '';
		failure = null;
		pendingRemoveId = null;
	}

	function reportFailure(error: unknown): void {
		failure =
			error instanceof ConvexError
				? String(error.data)
				: error instanceof Error
					? error.message
					: m.state_saveFailed();
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const cents = amountCents;
		if (isSaving || !transaction || cents === null || !canSubmit) return;

		const project = projectId === CAMPAIGN_ONLY ? undefined : (projectId as Id<'projects'>);

		isSaving = true;
		failure = null;
		try {
			if (editingId) {
				await client.mutation(api.allocations.mutations.updateAllocation, {
					allocationId: editingId,
					amountCents: cents,
					budgetItem: budgetItem.trim(),
					projectId: project
				});
			} else {
				await client.mutation(api.allocations.mutations.createAllocation, {
					transactionId: transaction._id,
					campaignId: campaignId as Id<'campaigns'>,
					projectId: project,
					amountCents: cents,
					budgetItem: budgetItem.trim() || undefined
				});
			}
			toast.success(m.money_allocationSaved());
			resetForm();
		} catch (error: unknown) {
			reportFailure(error);
		} finally {
			isSaving = false;
		}
	}

	async function removeAllocation(allocationId: Id<'allocations'>): Promise<void> {
		if (isRemoving) return;
		isRemoving = true;
		failure = null;
		try {
			await client.mutation(api.allocations.mutations.deleteAllocation, { allocationId });
			if (editingId === allocationId) resetForm();
			pendingRemoveId = null;
		} catch (error: unknown) {
			reportFailure(error);
		} finally {
			isRemoving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-2xl">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.money_allocations()}</Dialog.Title>
			{#if transaction}
				<Dialog.Description>
					{formatCents(transaction.amountCents)}
					{#if transaction.occurredOn}
						· {transaction.occurredOn}
					{/if}
					{#if transaction.reference}
						· {transaction.reference}
					{/if}
				</Dialog.Description>
			{/if}
		</Dialog.Header>

		<div class="flex w-full flex-col gap-2">
			<div class="flex items-center justify-between gap-3 text-sm">
				<span class="text-muted-foreground">{m.money_remaining()}</span>
				{#if unattributedCents === 0}
					<Badge variant="success">{m.money_fullyAllocated()}</Badge>
				{:else}
					<span class="font-medium tabular-nums">{formatCents(unattributedCents)}</span>
				{/if}
			</div>
			<Progress value={attributedPercent} />
		</div>

		{#if isLoading}
			<div class="flex w-full flex-col gap-2">
				<Skeleton class="h-10 w-full" />
				<Skeleton class="h-10 w-full" />
			</div>
		{:else if allocations.length === 0}
			<EmptyState class="w-full" title={m.state_empty()} />
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>{m.money_allocationCampaign()}</Table.Head>
						<Table.Head>{m.money_allocationProject()}</Table.Head>
						<Table.Head>{m.money_budgetItem()}</Table.Head>
						<Table.Head>{m.money_allocationAmount()}</Table.Head>
						{#if canWrite}
							<Table.Head class="text-right">{m.field_actions()}</Table.Head>
						{/if}
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each allocations as allocation (allocation._id)}
						<Table.Row>
							<Table.Cell class="text-muted-foreground">
								{campaignName(allocation.campaignId)}
							</Table.Cell>
							<Table.Cell class="font-medium">{projectName(allocation.projectId)}</Table.Cell>
							<Table.Cell class="text-muted-foreground">
								{allocation.budgetItem || '—'}
							</Table.Cell>
							<Table.Cell class="font-medium tabular-nums">
								{formatCents(allocation.amountCents)}
							</Table.Cell>
							{#if canWrite}
								<Table.Cell class="text-right">
									{#if pendingRemoveId === allocation._id}
										<div class="flex items-center justify-end gap-2">
											<span class="text-muted-foreground text-xs">
												{m.money_deleteAllocation()}
											</span>
											<Button
												size="sm"
												variant="destructive"
												loading={isRemoving}
												disabled={isRemoving}
												onclick={() => removeAllocation(allocation._id)}
											>
												{m.action_confirm()}
											</Button>
											<Button
												size="sm"
												variant="outline"
												disabled={isRemoving}
												onclick={() => (pendingRemoveId = null)}
											>
												{m.action_cancel()}
											</Button>
										</div>
									{:else}
										<div class="flex items-center justify-end gap-1">
											<Button
												size="sm"
												variant="ghost"
												aria-label={m.action_edit()}
												onclick={() => startEdit(allocation)}
											>
												<PencilIcon class="size-4" />
											</Button>
											<Button
												size="sm"
												variant="ghost"
												aria-label={m.money_deleteAllocation()}
												onclick={() => (pendingRemoveId = allocation._id)}
											>
												<Trash2Icon class="size-4" />
											</Button>
										</div>
									{/if}
								</Table.Cell>
							{/if}
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}

		{#if formOpen}
			<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4 border-t pt-4">
				<p class="text-sm font-medium">
					{editing !== null ? m.action_edit() : m.money_allocateTo()}
				</p>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-1.5">
						<Label>{m.money_allocationCampaign()}</Label>
						<Select.Root
							collection={campaignCollection}
							value={campaignId === '' ? [] : [campaignId]}
							disabled={editing !== null}
							onValueChange={(details: { value: string[] }): void => {
								const next = details.value[0];
								if (!next) return;
								campaignId = next;
								projectId = CAMPAIGN_ONLY;
							}}
						>
							<Select.Trigger class="w-full" placeholder={m.money_allocationCampaign()} />
							<Select.Content>
								{#each campaignCollection.items as option (option.value)}
									<Select.Item item={option}>
										<Select.ItemText>{option.label}</Select.ItemText>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>

					<div class="flex flex-col gap-1.5">
						<Label>{m.money_allocationProject()}</Label>
						<Select.Root
							collection={projectCollection}
							value={[projectId]}
							onValueChange={(details: { value: string[] }): void => {
								const next = details.value[0];
								if (next) projectId = next;
							}}
						>
							<Select.Trigger class="w-full" placeholder={m.money_allocationNone()} />
							<Select.Content>
								{#each projectCollection.items as option (option.value)}
									<Select.Item item={option}>
										<Select.ItemText>{option.label}</Select.ItemText>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<AmountField
						id="allocation-amount"
						label={m.money_allocationAmount()}
						bind:value={amount}
						error={amountError}
						help={`${m.money_remaining()}: ${formatCents(liveRemainingCents)}`}
					/>
					<div class="flex flex-col gap-1.5">
						<Label for="allocation-budget">{m.money_budgetItem()}</Label>
						<Input id="allocation-budget" bind:value={budgetItem} />
					</div>
				</div>

				{#if failure}
					<Alert.Root variant="warning" class="w-full">
						<TriangleAlertIcon class="size-4" />
						<Alert.Title>{m.state_error()}</Alert.Title>
						<Alert.Description>{failure}</Alert.Description>
					</Alert.Root>
				{/if}

				<div class="flex justify-end gap-2">
					{#if editing !== null}
						<Button type="button" variant="outline" onclick={resetForm} disabled={isSaving}>
							{m.action_cancel()}
						</Button>
					{/if}
					<Button type="submit" loading={isSaving} disabled={isSaving || !canSubmit}>
						{editing !== null ? m.action_save() : m.action_add()}
					</Button>
				</div>
			</form>
		{:else if canWrite && unattributedCents === 0}
			<p class="text-muted-foreground w-full text-sm">{m.money_fullyAllocated()}</p>
		{/if}

		<Dialog.Footer class="w-full">
			<Button variant="outline" onclick={() => (open = false)}>{m.action_done()}</Button>
		</Dialog.Footer>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
