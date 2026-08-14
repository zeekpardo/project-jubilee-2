<script lang="ts">
	// The audit trail: every model call behind this conversation, in the order it
	// happened. Inspection, not conversation — deliberately a different shape from
	// the transcript, because the question this answers is "why did it say that",
	// not "what was said".
	//
	// A failed call is a FIRST-CLASS entry here, with an empty input and output
	// and a destructive dot. Skipping it would be the single most misleading thing
	// this component could do: "the model was never asked" and "the model was
	// asked and the call fell over" produce the same silence in a transcript, and
	// only one of them is a bug worth chasing.
	//
	// Inputs run to the whole family profile plus the transcript, so both sides
	// are behind a native <details>. Collapsed by default and native rather than
	// an accordion primitive so browser find-in-page and Ctrl-F still reach them.

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import ActivityIcon from '@lucide/svelte/icons/activity';

	import * as m from '$lib/i18n/messages';
	import { turnRoleLabel } from './labels';
	import type { ConversationTurnRow } from './types';

	let { turns }: { turns: ConversationTurnRow[] } = $props();

	// By turn, then original order within a turn — the responder call and the
	// judge call that graded it share a number, and their sequence is the array's.
	// `sort` is stable in every engine this ships to, so a plain copy is enough.
	const ordered = $derived([...turns].sort((a, b) => a.turnNumber - b.turnNumber));
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.checkinTrace_title()}</Card.Title>
		<Card.Description>{m.checkinTrace_body()}</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if ordered.length === 0}
			<EmptyState size="sm" variant="plain" title={m.checkinTrace_empty()}>
				{#snippet icon()}
					<ActivityIcon />
				{/snippet}
			</EmptyState>
		{:else}
			<ol class="border-border relative space-y-4 border-l pl-5">
				{#each ordered as turn (turn._id)}
					<li class="relative flex flex-col gap-2">
						<span
							class="border-card absolute top-1.5 -left-[26px] h-2.5 w-2.5 rounded-full border-2 {turn.error
								? 'bg-destructive'
								: 'bg-border'}"
							aria-hidden="true"
						></span>

						<div class="flex flex-wrap items-center gap-2">
							<Badge variant="secondary">{turnRoleLabel(turn.role)}</Badge>
							<span class="text-muted-foreground text-xs">
								{m.checkinObjectives_turn({ number: turn.turnNumber })}
							</span>
							<span class="text-muted-foreground font-mono text-xs">
								{turn.promptVersion} · {turn.model}
							</span>
						</div>

						<div class="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
							<span>{m.checkinTrace_latency({ ms: turn.latencyMs })}</span>
							{#if turn.inputTokens !== undefined || turn.outputTokens !== undefined}
								<span>
									{m.checkinTrace_tokens({
										input: turn.inputTokens ?? 0,
										output: turn.outputTokens ?? 0
									})}
								</span>
							{/if}
						</div>

						{#if turn.error}
							<div class="flex flex-col gap-1">
								<span class="text-destructive text-xs font-medium">{m.checkinTrace_failed()}</span>
								<p class="text-destructive text-xs">{turn.error}</p>
							</div>
						{/if}

						{#if turn.input}
							<details>
								<summary class="text-muted-foreground cursor-pointer text-xs select-none">
									{m.checkinTrace_input()}
								</summary>
								<div class="bg-muted mt-2 max-h-80 overflow-y-auto rounded p-3">
									<pre class="text-xs break-words whitespace-pre-wrap">{turn.input}</pre>
								</div>
							</details>
						{/if}

						{#if turn.output}
							<details>
								<summary class="text-muted-foreground cursor-pointer text-xs select-none">
									{m.checkinTrace_output()}
								</summary>
								<div class="bg-muted mt-2 max-h-80 overflow-y-auto rounded p-3">
									<pre class="text-xs break-words whitespace-pre-wrap">{turn.output}</pre>
								</div>
							</details>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
	</Card.Content>
</Card.Root>
