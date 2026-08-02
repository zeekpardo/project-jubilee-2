<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Switch } from '$lib/primitives/ui/switch';
	import type { SwitchCheckedChangeDetails } from '$lib/primitives/ui/switch';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import {
		statConfigId,
		resolveStatConfigs,
		type StatConfig,
		type StatSource
	} from '$lib/domain/campaign-stats';
	import { formatCents } from '$lib/features/money/format';
	import AddStatDialog from './AddStatDialog.svelte';
	import type { Campaign } from './types';
	import * as m from '$lib/i18n/messages';

	let { campaign, canWrite }: { campaign: Campaign; canWrite: boolean } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const campaignId = $derived(campaign._id as Id<'campaigns'>);

	// Current numbers plus, per row, whether the public site would actually show
	// it. Warning an admin here is the whole reason this query exists — a stat
	// that silently fails to appear is worse than one that says why.
	const previewResponse = useQuery(api.campaigns.queries.previewStats, () => ({ campaignId }));
	const preview = $derived(previewResponse.data ?? []);

	let rows = $state<StatConfig[]>([]);
	let isSaving = $state(false);

	// One-time seed, same rule as the other campaign cards: a live update must
	// not fight edits in progress. An unset selection seeds from the registry
	// defaults, which is exactly what the campaign is publishing today.
	let loaded = $state(false);
	$effect(() => {
		if (loaded) return;
		rows = resolveStatConfigs(campaign.publicStats as StatConfig[] | undefined);
		loaded = true;
	});

	const chosen = $derived(new Set(rows.map((row) => row.id)));

	let addOpen = $state(false);

	/** Appended in the order chosen; ordering afterwards is the arrows' job. */
	function addStat(source: StatSource): void {
		const id = statConfigId(source);
		if (chosen.has(id)) return;
		rows = [
			...rows,
			{ id, order: rows.length, showOnPublic: true, showOnDashboard: false, source }
		];
	}

	function move(index: number, delta: number): void {
		const target = index + delta;
		if (target < 0 || target >= rows.length) return;
		const next = [...rows];
		[next[index], next[target]] = [next[target], next[index]];
		rows = next.map((row, position) => ({ ...row, order: position }));
	}

	function remove(id: string): void {
		rows = rows
			.filter((row) => row.id !== id)
			.map((row, position) => ({ ...row, order: position }));
	}

	function previewFor(id: string) {
		return preview.find((stat) => stat.id === id) ?? null;
	}

	/** The number as the admin's own site would print it. */
	function formatValue(value: number, format: string): string {
		return format === 'money' ? formatCents(value) : value.toLocaleString('en-US');
	}

	/**
	 * Why a row would not appear publicly. Only shown for rows actually flagged
	 * public — a dashboard-only stat is meant to be withheld.
	 */
	function issueMessage(issue: string | null | undefined): string | null {
		switch (issue) {
			case 'small_count':
				return m.campaignStats_issueSmallCount();
			case 'small_bucket':
				return m.campaignStats_issueSmallBucket();
			case 'private_field':
				return m.campaignStats_issuePrivateField();
			case 'protected_key':
				return m.campaignStats_issueProtectedKey();
			case 'missing_field':
				return m.campaignStats_issueMissingField();
			case 'unknown_metric':
				return m.campaignStats_issueUnknownMetric();
			default:
				return null;
		}
	}

	function sourceBadge(source: StatSource): string {
		if (source.kind === 'builtin') return m.campaignStats_sourceBuiltin();
		if (source.kind === 'field') return m.campaignStats_sourceField();
		if (source.kind === 'member') return m.campaignStats_sourcePeople();
		return m.campaignStats_sourceTask();
	}

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canWrite) return;
		isSaving = true;
		try {
			await client.mutation(api.campaigns.mutations.setPublicStats, {
				campaignId,
				stats: rows.map((row, index) => ({
					id: row.id,
					label: row.label?.trim() || undefined,
					order: index,
					showOnPublic: row.showOnPublic,
					showOnDashboard: row.showOnDashboard,
					source: row.source
				}))
			});
			toast.success(m.campaigns_updated());
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.campaignStats_title()}</Card.Title>
		<Card.Description>{m.campaignStats_body()}</Card.Description>
	</Card.Header>
	<Card.Content>
		<form class="flex flex-col gap-6" onsubmit={save}>
			{#if rows.length === 0}
				<EmptyState variant="plain" size="sm" title={m.campaignStats_empty()} />
			{:else}
				<ul class="flex flex-col gap-3">
					{#each rows as row, index (row.id)}
						{@const stat = previewFor(row.id)}
						{@const issue = row.showOnPublic ? issueMessage(stat?.publicIssue) : null}
						<li class="flex flex-col gap-3 rounded-md border p-4">
							<div class="flex flex-wrap items-center gap-3">
								<Badge variant="outline">{sourceBadge(row.source)}</Badge>
								<span class="min-w-0 flex-1 truncate text-sm font-medium">
									{stat?.label ?? row.id}
								</span>
								{#if stat}
									<span class="text-muted-foreground text-sm tabular-nums">
										{formatValue(stat.value, stat.format)}
									</span>
								{/if}
								<div class="flex items-center gap-1">
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label={m.settings_stageMoveUp()}
										disabled={!canWrite || index === 0}
										onclick={() => move(index, -1)}
									>
										<ChevronUpIcon />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label={m.settings_stageMoveDown()}
										disabled={!canWrite || index === rows.length - 1}
										onclick={() => move(index, 1)}
									>
										<ChevronDownIcon />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label={m.action_remove()}
										disabled={!canWrite}
										onclick={() => remove(row.id)}
									>
										<Trash2Icon />
									</Button>
								</div>
							</div>

							<div class="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
								<div class="flex flex-col gap-2">
									<Label for={`stat-label-${row.id}`}>{m.campaignStats_labelOverride()}</Label>
									<Input
										id={`stat-label-${row.id}`}
										value={row.label ?? ''}
										placeholder={stat?.label ?? ''}
										disabled={!canWrite}
										oninput={(event: Event & { currentTarget: HTMLInputElement }) => {
											row.label = event.currentTarget.value;
										}}
									/>
								</div>
								<div class="flex items-center gap-2">
									<Switch
										id={`stat-public-${row.id}`}
										checked={row.showOnPublic}
										disabled={!canWrite}
										onCheckedChange={(details: SwitchCheckedChangeDetails): void => {
											row.showOnPublic = details.checked;
										}}
									/>
									<Label for={`stat-public-${row.id}`}>{m.campaignStats_onPublic()}</Label>
								</div>
								<div class="flex items-center gap-2">
									<Switch
										id={`stat-dashboard-${row.id}`}
										checked={row.showOnDashboard}
										disabled={!canWrite}
										onCheckedChange={(details: SwitchCheckedChangeDetails): void => {
											row.showOnDashboard = details.checked;
										}}
									/>
									<Label for={`stat-dashboard-${row.id}`}>{m.campaignStats_onDashboard()}</Label>
								</div>
							</div>

							{#if issue}
								<p class="text-warning-700-300 flex items-center gap-2 text-xs">
									<EyeOffIcon class="size-3.5 shrink-0" aria-hidden="true" />
									{issue}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if canWrite}
				<!-- One way in. The dialog asks what the stat should count, then
				     shows only the choices that question implies. -->
				<div>
					<Button type="button" variant="outline" onclick={() => (addOpen = true)}>
						<PlusIcon />
						{m.campaignStats_addTitle()}
					</Button>
				</div>

				<div class="flex justify-end">
					<Button type="submit" loading={isSaving} disabled={isSaving}>
						{m.action_saveChanges()}
					</Button>
				</div>
			{/if}
		</form>
	</Card.Content>
</Card.Root>

<AddStatDialog bind:open={addOpen} {campaign} taken={chosen} onAdd={addStat} />
