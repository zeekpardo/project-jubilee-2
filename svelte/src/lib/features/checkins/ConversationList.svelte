<script lang="ts">
	// The left pane: the conversation queue for one campaign.
	//
	// The status filter is server-side, the same contract TripsBrowser keeps. It
	// matters more here than there: `listCheckins` takes a capped page, so
	// filtering a truncated list in the browser would quietly report an empty
	// escalation queue whenever the newest 50 conversations happened to be calm.
	//
	// The filter itself is plain `$state`, NOT the URL. Only the selected
	// conversation is linkable — a link is a link to a family's transcript, not to
	// how somebody had their queue sorted when they sent it.

	// Primitives
	import * as Select from '$lib/primitives/ui/select';
	import { Badge } from '$lib/primitives/ui/badge';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { Input } from '$lib/primitives/ui/input';
	import { createListCollection } from '@ark-ui/svelte/select';
	import SearchIcon from '@lucide/svelte/icons/search';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';
	import { CHECKIN_STATUSES, checkinStatusLabel } from './labels';
	import type { CheckinStatus } from './types';
	import ConversationRow from './ConversationRow.svelte';

	let {
		campaignId,
		selectedId,
		onSelect
	}: {
		campaignId: Id<'campaigns'>;
		selectedId: string | null;
		onSelect: (id: string) => void;
	} = $props();

	const { api } = getAuthContext();
	const auth = useAuth();

	const ALL_STATUSES = 'all';

	let statusFilter = $state<CheckinStatus | typeof ALL_STATUSES>(ALL_STATUSES);

	const response = useQuery(api.checkins.queries.listCheckins, () =>
		auth.isAuthenticated
			? {
					campaignId,
					...(statusFilter === ALL_STATUSES ? {} : { status: statusFilter })
				}
			: 'skip'
	);
	const rows = $derived(response.data ?? []);

	// A second subscription rather than a count taken from `rows`: the moment
	// somebody filters to "Closed", a count derived from the visible page would
	// read zero and the one number on this screen that must never be wrong is how
	// many families are waiting on a person.
	const escalatedResponse = useQuery(api.checkins.queries.listCheckins, () =>
		auth.isAuthenticated ? { campaignId, status: 'escalated' as const } : 'skip'
	);
	const escalatedCount = $derived(escalatedResponse.data?.length ?? 0);

	// Client-side, over the page already fetched, and deliberately so: this
	// narrows a queue somebody is looking at rather than searching the campaign.
	// The status filter above is the one that must be server-side, because a
	// truncated page would under-report escalations; a name search that only
	// covers the visible page is honest about being a way to find a row on screen.
	let search = $state('');

	const visibleRows = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		if (!needle) return rows;
		return rows.filter((row) =>
			`${row.projectName ?? ''} ${row.projectNumber ?? ''}`.toLowerCase().includes(needle)
		);
	});

	const statusCollection = createListCollection({
		items: [
			{ value: ALL_STATUSES, label: m.checkins_filterAll() },
			...CHECKIN_STATUSES.map((value) => ({ value, label: checkinStatusLabel(value) }))
		]
	});
</script>

<div class="border-border flex flex-col gap-3 border-b p-3">
	<div class="flex items-start justify-between gap-2">
		<div class="min-w-0">
			<p class="truncate text-sm font-medium">{m.checkins_conversations()}</p>
			<p class="text-muted-foreground text-xs">
				{m.checkins_conversationCount({ count: rows.length })}
			</p>
		</div>

		{#if escalatedCount > 0}
			<button
				type="button"
				class="focus-visible:ring-ring shrink-0 rounded-md focus-visible:ring-2 focus-visible:outline-none"
				onclick={() => (statusFilter = 'escalated')}
			>
				<Badge variant="destructive">
					{m.checkins_openEscalations({ count: escalatedCount })}
				</Badge>
			</button>
		{/if}
	</div>

	<div class="relative">
		<SearchIcon
			class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
			aria-hidden="true"
		/>
		<Input
			bind:value={search}
			class="pl-9"
			placeholder={m.checkins_searchPlaceholder()}
			aria-label={m.checkins_searchPlaceholder()}
			autocomplete="off"
		/>
	</div>

	<Select.Root
		collection={statusCollection}
		value={[statusFilter]}
		onValueChange={(details: { value: string[] }): void => {
			statusFilter = (details.value[0] as CheckinStatus | typeof ALL_STATUSES) ?? ALL_STATUSES;
		}}
	>
		<Select.Label class="sr-only">{m.field_status()}</Select.Label>
		<Select.Trigger size="sm" class="w-full" placeholder={m.checkins_filterAll()} />
		<Select.Content>
			{#each statusCollection.items as option (option.value)}
				<Select.Item item={option}>
					<Select.ItemText>{option.label}</Select.ItemText>
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
</div>

<!-- `role="list"` sits on the rows container only. Wrapping the skeletons and
     the no-results state in it too would announce three loading placeholders as
     three conversations. -->
{#if response.isLoading}
	<div class="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 pr-1">
		<Skeleton class="h-16 w-full" />
		<Skeleton class="h-16 w-full" />
		<Skeleton class="h-16 w-full" />
	</div>
{:else if visibleRows.length === 0}
	<div class="min-h-0 flex-1 overflow-y-auto p-2 pr-1">
		<EmptyState size="sm" variant="plain" title={m.list_noResults()} />
	</div>
{:else}
	<div role="list" class="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 pr-1">
		{#each visibleRows as row (row._id)}
			<ConversationRow {row} selected={row._id === selectedId} onSelect={() => onSelect(row._id)} />
		{/each}
	</div>
{/if}
