<script lang="ts">
	// The one block in this feature that is never behind a tab and never
	// collapsed. An escalation means a reply from a freed family matched a phrase
	// the engine will not answer around — the machine has stopped, and the only
	// thing that moves the conversation forward now is a person reading this.
	// Anything that could hide it (a tab, an accordion, a "3 alerts" pill) is a
	// way for that not to happen, so this renders inline under the conversation
	// header, expanded, above the transcript.
	//
	// No `Can` wrapper on the actions, deliberately. `getCheckin` already refuses
	// to return escalation rows to a viewer who may not read them, and both
	// mutations re-check `projects:write` against the escalation's own campaign.
	// A visible button that the server would refuse is a better failure than an
	// invisible one that leaves a person assuming somebody else has it.

	// Primitives
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';
	import { absoluteTimestamp } from './format';
	import {
		escalationCategoryLabel,
		escalationStatusLabel,
		escalationStatusVariant
	} from './labels';
	import type { CheckinDetail } from './types';
	import ResolveEscalationDialog from './ResolveEscalationDialog.svelte';

	let {
		escalations,
		conversationId
	}: {
		escalations: CheckinDetail['escalations'];
		conversationId: Id<'checkinConversations'>;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	// GROUPED BY THE MESSAGE THAT RAISED THEM. One sentence can match several
	// phrases — "he hit me again and I am afraid for my life" trips two — and a
	// banner per match repeats the same paragraph and the same quotation twice,
	// with only the matched term differing. That buries the one thing that
	// actually differs and makes two matches look like two incidents.
	//
	// One block per turn, then, listing every category and term it matched. The
	// actions stay per-escalation because the rows are resolved independently:
	// a person can have dealt with the violence and not the self-harm.
	const groups = $derived.by(() => {
		// A plain array rather than a Map: the lint rule against mutable built-in
		// Maps is about reactive state, and a handful of escalations does not need
		// a hash to group by.
		const grouped: { turnNumber: number; rows: CheckinDetail['escalations'] }[] = [];
		for (const escalation of escalations) {
			const existing = grouped.find((group) => group.turnNumber === escalation.turnNumber);
			if (existing) existing.rows.push(escalation);
			else grouped.push({ turnNumber: escalation.turnNumber, rows: [escalation] });
		}
		return grouped.sort((a, b) => a.turnNumber - b.turnNumber);
	});

	let acknowledging = $state<string | null>(null);
	let resolveOpen = $state(false);
	let resolving = $state<Id<'checkinEscalations'> | null>(null);

	async function acknowledge(escalationId: Id<'checkinEscalations'>): Promise<void> {
		if (acknowledging !== null) return;
		acknowledging = escalationId as string;
		try {
			await client.mutation(api.checkins.mutations.acknowledgeEscalation, {
				escalationId,
				now: Date.now()
			});
			toast.success(m.escalation_acknowledged());
		} catch (error: unknown) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			acknowledging = null;
		}
	}

	function openResolve(escalationId: Id<'checkinEscalations'>): void {
		resolving = escalationId;
		resolveOpen = true;
	}
</script>

<!--
	Nothing at all when there is nothing to say. An empty "no escalations" panel
	sitting permanently above every transcript would train people to look past
	the place the real one appears.
-->
{#if escalations.length > 0}
	<!--
		Keyed on the conversation so moving between check-ins remounts the block.
		Without it a half-typed resolution note, and the id it belongs to, would
		survive into the next family's escalation.
	-->
	{#key conversationId}
		<section class="flex flex-col gap-3">
			{#each groups as group (group.turnNumber)}
				<div class="border-destructive/50 bg-destructive/10 rounded-lg border p-4">
					<div class="flex items-start gap-3">
						<TriangleAlertIcon class="text-destructive mt-0.5 size-5 shrink-0" aria-hidden="true" />
						<div class="flex min-w-0 flex-1 flex-col gap-3">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="text-sm font-semibold">{m.escalation_title()}</h3>
								<!-- Every category this one message matched. Deliberately not
								     de-duplicated down to one: "violence and self-harm" is a
								     different phone call from either alone. -->
								{#each group.rows as row (row._id)}
									<Badge variant="destructive">{escalationCategoryLabel(row.category)}</Badge>
								{/each}
							</div>

							<p class="text-sm">{m.escalation_body()}</p>

							<p class="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
								{#each group.rows as row (row._id)}
									<span>{m.escalation_matched({ term: row.term })}</span>
								{/each}
								<span>{m.escalation_turn({ number: group.turnNumber })}</span>
							</p>

							<!-- The family's own words, not a summary of them. Once: every row
							     in this group quotes the same message. -->
							<blockquote class="border-destructive/40 border-l-2 pl-3 text-sm italic">
								{group.rows[0].excerpt}
							</blockquote>

							{#each group.rows as escalation (escalation._id)}
								<div
									class="border-destructive/30 flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0"
								>
									<div class="flex flex-wrap items-center gap-2">
										<span class="text-xs font-medium"
											>{escalationCategoryLabel(escalation.category)}</span
										>
										<Badge variant={escalationStatusVariant(escalation.status)}>
											{escalationStatusLabel(escalation.status)}
										</Badge>
									</div>

									{#if escalation.status === 'resolved'}
										{#if escalation.note}
											<div class="flex flex-col gap-1">
												<span class="text-muted-foreground text-xs font-medium">
													{m.escalation_resolveNote()}
												</span>
												<p class="text-sm">{escalation.note}</p>
											</div>
										{/if}
										{#if escalation.resolvedAt}
											<p class="text-muted-foreground text-xs">
												{absoluteTimestamp(escalation.resolvedAt)}
											</p>
										{/if}
									{:else}
										<div class="flex flex-wrap gap-2">
											{#if escalation.status === 'open'}
												<Button
													variant="outline"
													size="sm"
													loading={acknowledging === (escalation._id as string)}
													disabled={acknowledging !== null}
													onclick={() => acknowledge(escalation._id)}
												>
													{m.escalation_acknowledge()}
												</Button>
											{/if}
											<Button
												variant="destructive"
												size="sm"
												onclick={() => openResolve(escalation._id)}
											>
												{m.escalation_resolve()}
											</Button>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				</div>
			{/each}
		</section>

		<!-- Keyed on the row, so the note field belongs to exactly one escalation. -->
		{#if resolving}
			{#key resolving}
				<ResolveEscalationDialog bind:open={resolveOpen} escalationId={resolving} />
			{/key}
		{/if}
	{/key}
{/if}
