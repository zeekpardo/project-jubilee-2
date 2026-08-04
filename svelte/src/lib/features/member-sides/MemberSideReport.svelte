<script lang="ts">
	// One campaign's report. The order of the blocks is the argument of §13:
	// the rows, then what the published numbers BECOME, and only then a button.
	// The confirm action is deliberately the last thing on the page — nothing
	// here auto-applies, and the number is on screen before the action is.
	//
	// The projection follows the ticks. Unticking someone re-runs the server's
	// what-if for exactly what is still selected, so the figures can never
	// describe a set other than the one the button will write.

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Checkbox } from '$lib/primitives/ui/checkbox';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import * as Alert from '$lib/primitives/ui/alert';
	import InfoIcon from '@lucide/svelte/icons/info';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';
	import { SvelteSet } from 'svelte/reactivity';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import { formatCents } from '$lib/features/money/format';
	import * as m from '$lib/i18n/messages';

	let { campaignId }: { campaignId: Id<'campaigns'> } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	/**
	 * Rows the admin has UNTICKED, rather than the ones they have ticked.
	 *
	 * Storing the negative keeps the query argument stable: with nothing
	 * unticked the report is asked for with no selection at all, which the
	 * server reads as "all of them". Only once someone unticks a row does the
	 * explicit list get sent, so opening the screen costs one read rather than
	 * two.
	 */
	const excluded = new SvelteSet<string>();

	// A snapshot of the row ids, so the query argument depends on the ROW SET
	// rather than on the response object it came from. Without it, deriving the
	// argument from the response would make the query an input to itself.
	let suspectIds = $state<string[]>([]);

	const selectedIds = $derived(suspectIds.filter((id) => !excluded.has(id)));

	const reportResponse = useQuery(api.projectMembers.audit.campaignAudit, () =>
		excluded.size === 0
			? { campaignId }
			: {
					campaignId,
					selectedMemberIds: selectedIds as Id<'projectMembers'>[]
				}
	);
	const report = $derived(reportResponse.data ?? null);
	const loading = $derived(reportResponse.isLoading);

	$effect(() => {
		const ids = (report?.suspects ?? []).map((row) => row.projectMemberId as string);
		const same = ids.length === suspectIds.length && ids.every((id, i) => id === suspectIds[i]);
		if (!same) suspectIds = ids;
	});

	const selectedCount = $derived(selectedIds.length);
	const allSelected = $derived(suspectIds.length > 0 && excluded.size === 0);
	const someSelected = $derived(excluded.size > 0 && selectedCount > 0);

	function toggle(id: string, checked: boolean): void {
		if (checked) excluded.delete(id);
		else excluded.add(id);
	}

	function toggleAll(checked: boolean): void {
		excluded.clear();
		if (!checked) for (const id of suspectIds) excluded.add(id);
	}

	/** The number as this campaign's own surfaces print it. */
	function formatValue(value: number, format: string): string {
		return format === 'money' ? formatCents(value) : value.toLocaleString('en-US');
	}

	/** "12 → 9", or the withheld marker where the public site shows nothing. */
	function publicText(value: number | null, format: string): string {
		return value === null ? m.memberSides_withheld() : formatValue(value, format);
	}

	let confirmOpen = $state(false);

	async function apply(): Promise<void> {
		const result = await client.mutation(api.projectMembers.audit.markMembersAsTeam, {
			campaignId,
			projectMemberIds: selectedIds as Id<'projectMembers'>[]
		});
		// Re-running a report someone already applied is a no-op, and saying so
		// is more honest than a success toast claiming rows were changed.
		toast.success(
			result.updated > 0
				? m.memberSides_applied({ count: result.updated })
				: m.memberSides_appliedNothing()
		);
		excluded.clear();
	}

	async function confirmApply(): Promise<void> {
		try {
			await apply();
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
			throw error;
		}
	}
</script>

{#if loading && !report}
	<Skeleton class="h-64 w-full" />
{:else if report}
	<Alert.Root>
		<InfoIcon class="size-4" />
		<Alert.Description>{m.memberSides_heuristicNote()}</Alert.Description>
	</Alert.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>{m.memberSides_rowsTitle()}</Card.Title>
			<Card.Description>{m.memberSides_rowsBody()}</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="overflow-hidden rounded-lg border">
				<Table.Root>
					<Table.Header class="bg-muted">
						<Table.Row>
							<Table.Head class="w-1">
								<Checkbox
									checked={allSelected ? true : someSelected ? 'indeterminate' : false}
									aria-label={m.memberSides_selectAll()}
									onCheckedChange={(details) => toggleAll(details.checked === true)}
								/>
							</Table.Head>
							<Table.Head>{m.memberSides_colPerson()}</Table.Head>
							<Table.Head>{m.memberSides_colRole()}</Table.Head>
							<Table.Head>{m.memberSides_colRecord()}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each report.suspects as suspect (suspect.projectMemberId)}
							{@const name = suspect.contactName || m.memberSides_unnamedContact()}
							<Table.Row>
								<Table.Cell>
									<Checkbox
										checked={!excluded.has(suspect.projectMemberId as string)}
										aria-label={m.memberSides_selectRow({ name })}
										onCheckedChange={(details) =>
											toggle(suspect.projectMemberId as string, details.checked === true)}
									/>
								</Table.Cell>
								<Table.Cell class="font-medium">{name}</Table.Cell>
								<Table.Cell>
									<!-- Verbatim: the raw text is what was flagged, and an admin
									     judging the guess needs to see what it read. -->
									<code class="text-xs">{suspect.role}</code>
								</Table.Cell>
								<Table.Cell class="whitespace-nowrap">
									{suspect.projectNumber} · {suspect.projectName}
									{#if !suspect.projectIsPublished}
										<Badge variant="outline" class="ml-1">{m.memberSides_recordInternal()}</Badge>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>{m.memberSides_impactTitle()}</Card.Title>
			<Card.Description>{m.memberSides_impactBody()}</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if report.stats.length === 0}
				<EmptyState
					title={m.memberSides_impactNoneTitle()}
					description={m.memberSides_impactNoneBody()}
				/>
			{:else}
				<div class="overflow-hidden rounded-lg border">
					<Table.Root>
						<Table.Header class="bg-muted">
							<Table.Row>
								<Table.Head>{m.memberSides_colStat()}</Table.Head>
								<Table.Head>{m.memberSides_colInternal()}</Table.Head>
								<Table.Head>{m.memberSides_colPublic()}</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each report.stats as stat (stat.id)}
								<Table.Row>
									<Table.Cell class="font-medium">
										{stat.label}
										{#if stat.showOnPublic}
											<Badge variant="secondary" class="ml-1">{m.memberSides_published()}</Badge>
										{/if}
									</Table.Cell>
									<Table.Cell class="whitespace-nowrap tabular-nums">
										{m.memberSides_arrow({
											before: formatValue(stat.before, stat.format),
											after: formatValue(stat.after, stat.format)
										})}
									</Table.Cell>
									<Table.Cell class="whitespace-nowrap tabular-nums">
										<!-- Tracked apart from the dashboard figure because the
										     correction can push a count under the small-count
										     threshold, which removes the tile from the site
										     entirely rather than merely lowering it. -->
										{#if stat.publicBefore === stat.publicAfter}
											<span class="text-muted-foreground">{m.memberSides_unchanged()}</span>
										{:else}
											{m.memberSides_arrow({
												before: publicText(stat.publicBefore, stat.format),
												after: publicText(stat.publicAfter, stat.format)
											})}
										{/if}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if report.households.length > 0}
		<Card.Root>
			<Card.Header>
				<Card.Title>{m.memberSides_householdsTitle()}</Card.Title>
				<Card.Description>{m.memberSides_householdsBody()}</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="overflow-hidden rounded-lg border">
					<Table.Root>
						<Table.Header class="bg-muted">
							<Table.Row>
								<Table.Head>{m.memberSides_colRecord()}</Table.Head>
								<Table.Head>{m.memberSides_colSize()}</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each report.households as household (household.projectId)}
								<Table.Row>
									<Table.Cell class="font-medium">
										{household.projectNumber} · {household.projectName}
										{#if !household.projectIsPublished}
											<Badge variant="outline" class="ml-1">
												{m.memberSides_recordInternal()}
											</Badge>
										{/if}
									</Table.Cell>
									<Table.Cell class="whitespace-nowrap tabular-nums">
										{m.memberSides_arrow({
											before: household.before.toLocaleString('en-US'),
											after: household.after.toLocaleString('en-US')
										})}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	<div class="flex justify-end">
		<Button disabled={selectedCount === 0} onclick={() => (confirmOpen = true)}>
			{selectedCount === 0
				? m.memberSides_applyNone()
				: m.memberSides_apply({ count: selectedCount })}
		</Button>
	</div>

	<ConfirmDialog
		bind:open={confirmOpen}
		title={m.memberSides_confirmTitle()}
		body={m.memberSides_confirmBody()}
		confirmLabel={m.memberSides_confirmAction()}
		onConfirm={confirmApply}
	/>
{/if}
