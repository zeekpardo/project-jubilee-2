<script lang="ts">
	// The two-pane inbox: the queue on the left, one conversation on the right.
	//
	// The selection lives in the URL as `?c=<conversationId>` for two reasons that
	// both matter here more than they would on a list of trips. A transcript is
	// the thing somebody pastes into a message asking a colleague to look at it,
	// and a check-in that has escalated is a thing somebody gets sent a link to.
	// Selection held in component state would survive neither the paste nor the
	// refresh. Same mechanism as the tab parameter on the trip page.
	//
	// It is one route, not two. A conversation opened at a separate URL would lose
	// the queue beside it, and the queue is the point: the next family waiting is
	// meant to be visible while you read this one.

	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';

	// Primitives
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';
	import ConversationList from './ConversationList.svelte';
	import ConversationThread from './ConversationThread.svelte';

	let { campaignId }: { campaignId: Id<'campaigns'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();

	// Whether the engine can run at all. Without a key a check-in opens, fails
	// its first turn, and leaves an empty thread with an error buried in the
	// model-calls tab — the failure is recorded honestly and is still invisible
	// unless you know to go looking. Saying so up front is the difference
	// between a misconfigured deployment and an apparently broken feature.
	//
	// A warning rather than a block: writing messages yourself works perfectly
	// well without a key, and this surface is now general messaging.
	const settingsResponse = useQuery(api.checkins.queries.checkinSettings, () =>
		auth.isAuthenticated ? {} : 'skip'
	);
	const engineUnavailable = $derived(
		settingsResponse.data ? !settingsResponse.data.apiKeyConfigured : false
	);

	// Unfiltered, and separate from the list's own subscription: this one answers
	// "does this campaign have any check-ins at all", which is the question that
	// decides between the two-pane inbox and a single empty state. Deriving it
	// from the filtered list would replace the whole screen with "no check-ins
	// yet" the moment somebody filtered to a status nothing was in.
	const response = useQuery(api.checkins.queries.listCheckins, () =>
		auth.isAuthenticated ? { campaignId } : 'skip'
	);
	const conversations = $derived(response.data ?? []);

	const selectedId = $derived(page.url.searchParams.get('c'));

	function select(id: string): void {
		if (id === selectedId) return;
		void goto(resolve(`${page.url.pathname}?c=${id}` as Pathname), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}
</script>

<!-- Above BOTH branches, including the empty state: a deployment with no key
     and no conversations is exactly the one where somebody is about to open
     their first check-in and watch nothing happen. -->
{#if engineUnavailable}
	<div class="border-destructive/50 bg-destructive/10 flex items-start gap-3 rounded-lg border p-3">
		<TriangleAlertIcon class="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />
		<div class="min-w-0">
			<p class="text-sm font-medium">{m.checkins_notConfigured()}</p>
			<p class="text-muted-foreground text-xs">{m.checkins_notConfiguredBody()}</p>
		</div>
	</div>
{/if}

{#if !response.isLoading && conversations.length === 0}
	<EmptyState title={m.messages_empty()} description={m.messages_emptyBody()}>
		{#snippet icon()}
			<MessagesSquareIcon />
		{/snippet}
	</EmptyState>
{:else}
	<div
		class="grid min-h-0 flex-1 grid-rows-[minmax(0,16rem)_1fr] gap-4 lg:grid-cols-[22rem_1fr] lg:grid-rows-1"
	>
		<div class="bg-card flex h-full min-h-0 flex-col overflow-hidden rounded-xl border">
			<ConversationList {campaignId} {selectedId} onSelect={select} />
		</div>

		<div class="bg-card flex h-full min-h-0 flex-col overflow-hidden rounded-xl border">
			{#if selectedId}
				<!-- Keyed so switching conversations starts a clean pane: scroll
				     position, the open tab and the "new messages" flag all belong to the
				     conversation that was being read, not to the pane. -->
				{#key selectedId}
					<ConversationThread conversationId={selectedId as Id<'checkinConversations'>} />
				{/key}
			{:else}
				<!-- Hidden below `lg`, where the two panes are stacked rows: a
				     placeholder telling you to choose from the list directly above it
				     is a whole screenful of restating the obvious. -->
				<div class="hidden h-full items-center justify-center p-6 lg:flex">
					<EmptyState
						variant="plain"
						title={m.checkins_noSelection()}
						description={m.checkins_noSelectionBody()}
					/>
				</div>
			{/if}
		</div>
	</div>
{/if}
