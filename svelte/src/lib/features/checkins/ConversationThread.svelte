<script lang="ts">
	// The right pane: one conversation, end to end.
	//
	// Order on this screen is an argument about what a reviewer must not be able
	// to miss. The escalation banner sits directly under the header and is never
	// behind a tab — a safety disclosure a person has to go looking for is a
	// safety disclosure that gets missed. The transcript, the objectives and the
	// model calls are all defensible behind tabs, because none of them is a
	// statement that somebody is in danger right now.
	//
	// There is no publish control anywhere in here, deliberately. A draft the
	// engine wrote is reviewed and published on the updates surface, behind
	// `content:publish`. Offering the button here would let the same click that
	// reads a conversation send a family's words to an audience.
	//
	// ONE PANE, TWO KINDS OF CONVERSATION. A `direct` thread is people talking:
	// no objectives, no model calls, no turn cap, and nothing the engine has
	// decided to do next. Every one of those is hidden rather than rendered
	// empty, because an Objectives tab with nothing in it invites the reader to
	// conclude the questions were missed rather than never asked. What a direct
	// conversation gains instead is the composer below and, when it names a
	// record, the button that hands the whole thread to the engine.

	// Primitives
	import * as Tabs from '$lib/primitives/ui/tabs';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import MessageSquarePlusIcon from '@lucide/svelte/icons/message-square-plus';
	import BotIcon from '@lucide/svelte/icons/bot';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { tick, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';
	import { MAX_RESPONDER_TURNS } from '$lib/domain/checkin-objectives';
	import { absoluteTimestamp, messageDayLabel, startsNewDay } from './format';
	import {
		checkinKindLabel,
		checkinKindVariant,
		checkinStatusLabel,
		checkinStatusVariant
	} from './labels';
	import { conversationKind } from './types';

	import MessageBubble from './MessageBubble.svelte';
	import ComposeMessage from './ComposeMessage.svelte';
	import ManualInboundDialog from './ManualInboundDialog.svelte';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import EscalationBanner from './EscalationBanner.svelte';
	import ObjectivesPanel from './ObjectivesPanel.svelte';
	import DecisionTrace from './DecisionTrace.svelte';

	let { conversationId }: { conversationId: Id<'checkinConversations'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();

	const response = useQuery(api.checkins.queries.getCheckin, () =>
		auth.isAuthenticated ? { conversationId } : 'skip'
	);
	const detail = $derived(response.data ?? null);
	const messages = $derived(detail?.messages ?? []);

	const client = useConvexClient();

	let inboundOpen = $state(false);
	let closeOpen = $state(false);
	let deleteOpen = $state(false);
	let isStartingCheckin = $state(false);

	// `direct` or `checkin`, read through the helper so an older row with no
	// column on it is still the check-in it has always been.
	const kind = $derived(detail ? conversationKind(detail.conversation) : 'checkin');
	const isCheckin = $derived(kind === 'checkin');

	// Where the draft actually lives. A check-in tells you one exists; without a
	// way to reach it the notice is a dead end, and the reviewer's next move is
	// to go hunting through the records list for a post they were just told
	// about.
	const draftHref = $derived.by(() => {
		const number = detail?.project?.number;
		if (!detail?.conversation.updateId || !number) return null;
		return `${resolve('/app/projects/[number]', { number })}?tab=updates` as Pathname;
	});

	async function confirmClose(): Promise<void> {
		if (!detail) return;
		try {
			await client.mutation(api.checkins.mutations.closeCheckin, {
				conversationId: detail.conversation._id,
				now: Date.now()
			});
			toast.success(m.checkinDetail_closed());
		} catch (error: unknown) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
			throw error;
		}
	}

	async function confirmDelete(): Promise<void> {
		if (!detail) return;
		try {
			await client.mutation(api.checkins.mutations.deleteCheckin, {
				conversationId: detail.conversation._id
			});
			toast.success(m.checkinDetail_deleted());
		} catch (error: unknown) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
			throw error;
		}
	}

	/** Handing an existing thread to the engine. Only reachable on a `direct`
	 *  conversation that still has a record to run against — the button is not
	 *  rendered otherwise, because a control for something inapplicable teaches
	 *  nothing that its absence does not. */
	async function startCheckinHere(): Promise<void> {
		if (!detail || isStartingCheckin) return;
		isStartingCheckin = true;
		try {
			await client.mutation(api.checkins.mutations.startCheckinOnConversation, {
				conversationId: detail.conversation._id,
				now: Date.now()
			});
			toast.success(m.checkinStart_started());
		} catch (error: unknown) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isStartingCheckin = false;
		}
	}

	// The transcript is the default, and the open tab is local state rather than a
	// URL parameter: `?c=` already makes a conversation linkable, and which of the
	// panes somebody had open is not part of what they are sharing.
	let activeTab = $state('transcript');

	// A conversation names a record, a person, or both, and the heading falls
	// through in that order. Without the contact fallback a thread with a sponsor
	// — who is on no record at all — renders under a bare em dash.
	const recordName = $derived(
		detail?.project?.name ?? detail?.project?.number ?? detail?.contact?.name ?? '—'
	);

	// Rendered as a muted pill rather than a Badge on purpose: every Badge variant
	// in this feature is chosen in labels.ts, and there is no decision-kind
	// mapping there to borrow. Inventing one inline is exactly how "escalated"
	// ends up urgent on one screen and neutral on the next.
	// Only on a check-in. `decideNext` reports `draft` for a conversation with no
	// objectives, and "Ready to draft" is a meaningless thing to say about a chat
	// with a sponsor that nobody asked anything in.
	const nextDecisionLabel = $derived.by(() => {
		if (!isCheckin) return null;
		switch (detail?.nextDecision.kind) {
			case 'escalated':
				return m.checkinDetail_nextEscalated();
			case 'ask':
				return m.checkinDetail_nextAsk();
			case 'review':
				return m.checkinDetail_nextReview();
			case 'draft':
				return m.checkinDetail_nextDraft();
			default:
				return null;
		}
	});

	// ---------------------------------------------------------------------
	// Scrolling
	// ---------------------------------------------------------------------
	// The reference messenger scrolls to the bottom on every data change, full
	// stop. That is right for a chat you are having and wrong for a transcript
	// you are reading: staff read these top-down, weeks of them, and an arriving
	// message would yank the page out from under the sentence they were on.
	//
	// So the jump only happens when the reader is already at the bottom — i.e.
	// when they were watching the live edge anyway. Otherwise the new message is
	// announced with a button they can ignore.

	/** How close to the bottom still counts as "watching the live edge". */
	const BOTTOM_SLACK_PX = 80;

	let scroller = $state<HTMLDivElement | null>(null);
	let atBottom = $state(true);
	let hasUnseen = $state(false);

	function prefersReducedMotion(): boolean {
		if (typeof window === 'undefined') return false;
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	function scrollToBottom(): void {
		if (!scroller) return;
		scroller.scrollTo({
			top: scroller.scrollHeight,
			behavior: prefersReducedMotion() ? 'auto' : 'smooth'
		});
	}

	function handleScroll(): void {
		if (!scroller) return;
		atBottom =
			scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= BOTTOM_SLACK_PX;
		if (atBottom) hasUnseen = false;
	}

	function jumpToLatest(): void {
		hasUnseen = false;
		atBottom = true;
		scrollToBottom();
	}

	const lastMessageId = $derived(messages.at(-1)?._id ?? null);

	$effect(() => {
		// Only the identity of the newest message is a dependency. `atBottom` is
		// read through `untrack` because it changes on every scroll event, and a
		// scroll that re-triggered the auto-scroll would be a loop.
		const latest = lastMessageId;
		if (!latest || !scroller) return;

		if (untrack(() => atBottom)) {
			void tick().then(scrollToBottom);
		} else {
			hasUnseen = true;
		}
	});
</script>

{#if response.isLoading}
	<div class="flex flex-col gap-3 p-4">
		<Skeleton class="h-6 w-48" />
		<Skeleton class="h-4 w-64" />
		<Skeleton class="h-40 w-full" />
	</div>
{:else if !detail}
	<div class="flex flex-1 items-center justify-center p-4">
		<EmptyState
			variant="plain"
			title={m.checkins_noSelection()}
			description={m.checkins_noSelectionBody()}
		/>
	</div>
{:else}
	<div class="flex min-h-0 flex-1 flex-col">
		<!-- 1. Header -->
		<div class="border-border flex flex-col gap-2 border-b p-4">
			<div class="flex flex-wrap items-center gap-2">
				<h3 class="truncate text-base font-semibold">{recordName}</h3>
				{#if detail.project?.number && detail.project?.name}
					<span class="text-muted-foreground text-xs">{detail.project.number}</span>
				{/if}
				<Badge variant={checkinKindVariant(kind)}>{checkinKindLabel(kind)}</Badge>
				<Badge variant={checkinStatusVariant(detail.conversation.status)}>
					{checkinStatusLabel(detail.conversation.status)}
				</Badge>
				{#if nextDecisionLabel}
					<span
						class="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap"
					>
						{nextDecisionLabel}
					</span>
				{/if}
			</div>

			<p class="text-muted-foreground text-xs">
				{m.checkinDetail_openedAt({ date: messageDayLabel(detail.conversation.openedAt) })}
				{#if detail.conversation.lastMessageAt}
					&middot;
					<!-- How long this family has been waiting is the fact a reviewer
					     wants first on a queue that has been left open. -->
					<span title={absoluteTimestamp(detail.conversation.lastMessageAt)}>
						{m.checkinDetail_lastMessage({
							date: messageDayLabel(detail.conversation.lastMessageAt)
						})}
					</span>
				{/if}
				<!-- The turn counter counts responder turns against the engine's cap.
				     On a conversation the engine was never given there is no cap and
				     nothing has been spent, so it is dropped — the same reason the
				     queue row drops it. -->
				{#if isCheckin}
					&middot;
					{m.checkinDetail_turnsSpent({
						spent: detail.conversation.turnsSpent,
						max: MAX_RESPONDER_TURNS
					})}
				{/if}
				&middot;
				{m.checkinDetail_locale({ locale: detail.conversation.locale })}
			</p>
		</div>

		<!-- 2. Escalations. Never behind a tab, never collapsed. -->
		<EscalationBanner escalations={detail.escalations} conversationId={detail.conversation._id} />

		<!-- 3. A draft is a draft. This says one exists and where to go; it does
		     not offer to publish it. -->
		{#if detail.conversation.updateId}
			<div class="bg-muted border-border flex flex-wrap items-center gap-3 border-b p-3">
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium">{m.checkinDetail_draftReady()}</p>
					<p class="text-muted-foreground text-xs">{m.checkinDetail_draftReadyBody()}</p>
				</div>
				{#if draftHref}
					<Button variant="outline" size="sm" href={draftHref}>
						<ExternalLinkIcon class="size-4" aria-hidden="true" />
						{m.checkinDetail_viewDraft()}
					</Button>
				{/if}
			</div>
		{/if}

		<!-- 4. Tabs -->
		<Tabs.Root bind:value={activeTab} class="min-h-0 flex-1 gap-3 p-4">
			<Tabs.List>
				<Tabs.Trigger value="transcript">{m.checkinDetail_transcript()}</Tabs.Trigger>
				<!-- Objectives and model calls are check-in concepts. A direct
				     conversation has neither, so it gets neither tab rather than two
				     panes that say "nothing here" about machinery that was never
				     involved. -->
				{#if isCheckin}
					<Tabs.Trigger value="objectives">{m.checkinDetail_objectives()}</Tabs.Trigger>
					<Tabs.Trigger value="trace">{m.checkinDetail_trace()}</Tabs.Trigger>
				{/if}
			</Tabs.List>

			<Tabs.Content value="transcript" class="flex min-h-0 flex-1 flex-col">
				{#if messages.length === 0}
					<EmptyState
						variant="plain"
						title={m.checkinDetail_noMessages()}
						description={m.checkinDetail_noMessagesBody()}
					/>
				{:else}
					<!-- 5. Transcript scroller -->
					<div class="relative flex min-h-0 flex-1 flex-col">
						<div
							bind:this={scroller}
							onscroll={handleScroll}
							class="min-h-0 flex-1 space-y-3 overflow-y-auto pr-2"
						>
							{#each messages as message, index (message._id)}
								{#if startsNewDay(message.at, messages[index - 1]?.at)}
									<div class="flex items-center gap-3 py-1">
										<span class="bg-border h-px flex-1"></span>
										<span class="text-muted-foreground text-xs">
											{messageDayLabel(message.at)}
										</span>
										<span class="bg-border h-px flex-1"></span>
									</div>
								{/if}
								<MessageBubble {message} />
							{/each}
						</div>

						{#if hasUnseen}
							<div class="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
								<Button
									size="sm"
									variant="secondary"
									class="pointer-events-auto shadow-md"
									onclick={jumpToLatest}
								>
									<ArrowDownIcon aria-hidden="true" />
									{m.checkinDetail_jumpToLatest()}
								</Button>
							</div>
						{/if}
					</div>
				{/if}
			</Tabs.Content>

			{#if isCheckin}
				<Tabs.Content value="objectives" class="min-h-0 flex-1 overflow-y-auto pr-2">
					<!-- `objectives` is optional on the document now that a direct
					     conversation asks nothing. A check-in always has them; the
					     fallback is here so the type is honest rather than asserted. -->
					<ObjectivesPanel
						objectives={detail.conversation.objectives ?? []}
						states={detail.objectiveStates}
						checks={detail.checks}
					/>
				</Tabs.Content>

				<Tabs.Content value="trace" class="min-h-0 flex-1 overflow-y-auto pr-2">
					<DecisionTrace turns={detail.turns} />
				</Tabs.Content>
			{/if}
		</Tabs.Root>

		<!-- 6. Footer. Recording an inbound reply is offered on EVERY status, not
		     just `open`, because `receiveMessage` stores the message whatever state
		     the conversation is in — and re-runs the escalation scan on it. An
		     already-escalated family who discloses something further must be able
		     to have that recorded, and gating the control on `open` would make the
		     second disclosure unreachable from the UI.
		     What changes off `open` is only that nothing further is asked, which is
		     what the notice beneath says. -->
		<div class="border-border flex flex-col gap-2 border-t p-3">
			<!-- Writing IN YOUR OWN WORDS, above the control that records somebody
			     else's. `sendMessage` refuses while the engine is mid-check-in, so
			     that case is replaced by the reason rather than offered as a box that
			     always errors. -->
			<ComposeMessage
				conversationId={detail.conversation._id}
				disabled={isCheckin && detail.conversation.status === 'open'}
				disabledReason={m.checkinCompose_disabledCheckin()}
			/>

			<div class="flex flex-wrap items-center gap-2">
				<Button variant="outline" size="sm" onclick={() => (inboundOpen = true)}>
					<MessageSquarePlusIcon aria-hidden="true" />
					{m.checkinDetail_simulate()}
				</Button>

				<!-- Handing this thread to the engine. Absent without a record: the
				     engine builds its family profile from one and
				     `startCheckinOnConversation` refuses without it, so a conversation
				     with a sponsor never offers the button at all. -->
				{#if !isCheckin && detail.conversation.status === 'open' && detail.conversation.projectId}
					<Button
						variant="outline"
						size="sm"
						loading={isStartingCheckin}
						disabled={isStartingCheckin}
						onclick={startCheckinHere}
					>
						<BotIcon aria-hidden="true" />
						{m.checkinStart_action()}
					</Button>
				{/if}

				<!-- Closing is offered only while something is still running. A
				     conversation that already reached `closed` or `escalated` has
				     nothing left to stop, and `closeCheckin` is one-way by design. -->
				{#if detail.conversation.status === 'open' || detail.conversation.status === 'needs_review'}
					<Button variant="ghost" size="sm" onclick={() => (closeOpen = true)}>
						{m.checkinDetail_close()}
					</Button>
				{/if}

				<Button
					variant="ghost"
					size="sm"
					class="text-muted-foreground ml-auto"
					onclick={() => (deleteOpen = true)}
				>
					{m.action_delete()}
				</Button>
			</div>
			{#if isCheckin && detail.conversation.status !== 'open'}
				<p class="text-muted-foreground text-xs">{m.checkinDetail_simulateClosed()}</p>
			{/if}
		</div>
	</div>

	<ManualInboundDialog conversationId={detail.conversation._id} bind:open={inboundOpen} />

	<!-- Both reuse ConfirmDialog rather than confirming inline: it keeps itself
	     open and shows the server's reason when a mutation is refused, which is
	     what a one-way action needs. -->
	<ConfirmDialog
		bind:open={closeOpen}
		title={m.checkinDetail_close()}
		body={m.checkinDetail_closeBody()}
		confirmLabel={m.action_confirm()}
		onConfirm={confirmClose}
	/>

	<ConfirmDialog
		bind:open={deleteOpen}
		title={m.checkinDetail_delete()}
		body={m.checkinDetail_deleteBody()}
		confirmLabel={m.action_delete()}
		onConfirm={confirmDelete}
	/>
{/if}
