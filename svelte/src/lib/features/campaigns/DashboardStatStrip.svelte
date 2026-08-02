<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Skeleton } from '$lib/primitives/ui/skeleton';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import { formatCentsCompact } from '$lib/features/money/format';
	import * as m from '$lib/i18n/messages';

	let { campaignId }: { campaignId: Id<'campaigns'> | null } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();

	// A date range, as the two ISO dates an <input type="date"> hands back.
	let from = $state('');
	let to = $state('');

	/**
	 * Parsed to epoch ms HERE rather than server-side: a Convex query is not
	 * rerun merely because time advances, so a clock read inside it would go
	 * stale and would cost the query cache. The upper bound is pushed to the end
	 * of the chosen day, so "to 3 March" includes the 3rd.
	 */
	const DAY_MS = 24 * 60 * 60 * 1000;
	function parseDate(value: string, endOfDay = false): number | undefined {
		if (!value) return undefined;
		const at = Date.parse(value);
		if (Number.isNaN(at)) return undefined;
		return endOfDay ? at + DAY_MS - 1 : at;
	}

	const response = useQuery(api.campaigns.queries.getDashboardStats, () =>
		auth.isAuthenticated && campaignId
			? { campaignId, from: parseDate(from), to: parseDate(to, true) }
			: 'skip'
	);
	const stats = $derived(response.data ?? []);
	const isFiltered = $derived(Boolean(from || to));

	function formatValue(value: number, format: string): string {
		return format === 'money' ? formatCentsCompact(value) : value.toLocaleString('en-US');
	}
</script>

{#if campaignId}
	<Card.Root>
		<Card.Header>
			<Card.Title>{m.dashStats_title()}</Card.Title>
			<Card.Description>{m.dashStats_body()}</Card.Description>
			<Card.Action>
				<div class="flex flex-wrap items-end gap-2">
					<div class="flex flex-col gap-1">
						<Label for="dash-stats-from" class="text-xs">{m.dashStats_from()}</Label>
						<Input id="dash-stats-from" type="date" class="w-40" bind:value={from} />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="dash-stats-to" class="text-xs">{m.dashStats_to()}</Label>
						<Input id="dash-stats-to" type="date" class="w-40" bind:value={to} />
					</div>
					{#if isFiltered}
						<Button
							variant="ghost"
							size="sm"
							onclick={() => {
								from = '';
								to = '';
							}}
						>
							{m.dashStats_clear()}
						</Button>
					{/if}
				</div>
			</Card.Action>
		</Card.Header>
		<Card.Content>
			{#if response.isLoading}
				<Skeleton class="h-16 w-full" />
			{:else if stats.length === 0}
				<p class="text-muted-foreground text-sm">{m.dashStats_empty()}</p>
			{:else}
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
					{#each stats as stat (stat.key)}
						<div>
							<p class="text-2xl font-semibold tabular-nums">
								{formatValue(stat.value, stat.format)}
							</p>
							<p class="text-muted-foreground mt-1 text-xs font-medium">{stat.label}</p>
							{#if isFiltered && stat.lifetime}
								<!-- No custom field carries a timestamp, so this one number in a
								     row of filtered ones is still the lifetime figure. Saying so
								     beats letting it be read as filtered. -->
								<p class="text-muted-foreground mt-0.5 text-[11px]">{m.dashStats_lifetime()}</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
{/if}
