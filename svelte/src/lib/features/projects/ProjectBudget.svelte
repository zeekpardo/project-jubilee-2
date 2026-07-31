<script lang="ts">
	import * as Card from '$lib/primitives/ui/card';
	import * as Table from '$lib/primitives/ui/table';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc } from '$convex/_generated/dataModel';

	import { Can } from '$lib/access';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import * as m from '$lib/i18n/messages';
	import { formatCents, targetCentsFor } from './format';
	import ProjectBudgetDialog from './ProjectBudgetDialog.svelte';

	let {
		project,
		budget,
		isLoading
	}: {
		project: Doc<'projects'>;
		budget: Doc<'budgets'> | null;
		isLoading: boolean;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let dialogOpen = $state(false);
	let deleteOpen = $state(false);

	function humanize(key: string): string {
		return key.replace(/_cents$/, '').replace(/[_-]+/g, ' ');
	}

	const lines = $derived([
		...Object.entries(budget?.templateSnapshot ?? {}).map(([key, cents]) => ({
			key: `snapshot:${key}`,
			label: humanize(key),
			cents
		})),
		...(budget && budget.debtCents !== 0
			? [{ key: 'debt', label: m.projects_debt(), cents: budget.debtCents }]
			: []),
		...(budget?.extras ?? []).map((extra, index) => ({
			key: `extra:${index}`,
			label: extra.label,
			cents: extra.amount_cents
		}))
	]);

	const targetCents = $derived(targetCentsFor(budget));

	async function deleteBudget(): Promise<void> {
		if (!budget) return;
		await client.mutation(api.budgets.mutations.deleteBudget, { budgetId: budget._id });
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.projects_lineItems()}</Card.Title>
		{#if budget}
			<Card.Description class="font-mono text-xs">{budget.templateVersion}</Card.Description>
			<Can do="projects:write" campaignId={project.campaignId}>
				<Card.Action>
					<div class="flex items-center gap-1">
						<Button variant="outline" size="sm" onclick={() => (dialogOpen = true)}>
							<PencilIcon class="size-4" aria-hidden="true" />
							{m.projects_budgetEdit()}
						</Button>
						<Button
							variant="ghost"
							size="icon"
							aria-label={m.projects_budgetDeleteTitle()}
							title={m.projects_budgetDeleteTitle()}
							onclick={() => (deleteOpen = true)}
						>
							<Trash2Icon class="size-4" aria-hidden="true" />
						</Button>
					</div>
				</Card.Action>
			</Can>
		{/if}
	</Card.Header>
	<Card.Content>
		{#if isLoading}
			<div class="flex flex-col gap-3">
				<Skeleton class="h-6 w-full" />
				<Skeleton class="h-6 w-full" />
				<Skeleton class="h-6 w-full" />
			</div>
		{:else if !budget}
			<EmptyState variant="plain" size="sm" title={m.projects_budgetNone()}>
				{#snippet action()}
					<Can do="projects:write" campaignId={project.campaignId}>
						<Button variant="outline" size="sm" onclick={() => (dialogOpen = true)}>
							<PlusIcon class="size-4" aria-hidden="true" />
							{m.projects_budgetCreate()}
						</Button>
					</Can>
				{/snippet}
			</EmptyState>
		{:else}
			<Table.Root>
				<Table.Header class="bg-muted">
					<Table.Row>
						<Table.Head>{m.field_name()}</Table.Head>
						<Table.Head class="text-right">{m.field_amount()}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each lines as line (line.key)}
						<Table.Row>
							<Table.Cell class="capitalize">{line.label}</Table.Cell>
							<Table.Cell class="text-right tabular-nums">{formatCents(line.cents)}</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
				<Table.Footer>
					<Table.Row>
						<Table.Cell class="font-medium">{m.projects_target()}</Table.Cell>
						<Table.Cell class="text-right font-medium tabular-nums">
							{formatCents(targetCents)}
						</Table.Cell>
					</Table.Row>
				</Table.Footer>
			</Table.Root>
		{/if}
	</Card.Content>
</Card.Root>

<ProjectBudgetDialog
	bind:open={dialogOpen}
	projectId={project._id}
	campaignId={project.campaignId}
	{budget}
/>

<ConfirmDialog
	bind:open={deleteOpen}
	title={m.projects_budgetDeleteTitle()}
	body={m.projects_budgetDeleteBody()}
	onConfirm={deleteBudget}
/>
