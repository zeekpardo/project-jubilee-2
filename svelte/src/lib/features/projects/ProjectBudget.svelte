<script lang="ts">
	import * as Card from '$lib/primitives/ui/card';
	import * as Table from '$lib/primitives/ui/table';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import type { Doc } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';
	import { formatCents, targetCentsFor } from './format';

	let { budget, isLoading }: { budget: Doc<'budgets'> | null; isLoading: boolean } = $props();

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
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.projects_lineItems()}</Card.Title>
		{#if budget}
			<Card.Description class="font-mono text-xs">{budget.templateVersion}</Card.Description>
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
			<EmptyState variant="plain" size="sm" title={m.state_empty()} />
		{:else}
			<Table.Root>
				<Table.Header>
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
