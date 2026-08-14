<script lang="ts">
	// What this check-in was trying to find out, and how close it got.
	//
	// The objectives rendered here are the SNAPSHOT frozen onto the conversation
	// when it opened — not today's default set. That is the point of the panel's
	// description, and it is the thing a reader most needs to know before they
	// judge a two-month-old conversation against wording that has since changed.
	//
	// Two thresholds decide everything downstream (`decideNext`), so they are what
	// this renders against: a rating at or above RATING_ANSWERED means the reply
	// actually answered, a confidence at or above CONFIDENCE_ACCEPT means the
	// judge trusts its own rating. A number that cleared its bar is set in
	// `font-medium`; one that did not is muted. No colour scale — a 0.68 is not
	// "amber", it is simply below the line, and inventing a gradient would imply a
	// precision the judge does not have.

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';

	import { CONFIDENCE_ACCEPT, RATING_ANSWERED } from '$lib/domain/checkin-objectives';
	import * as m from '$lib/i18n/messages';
	import { asPercent } from './format';
	import { objectiveStateLabel, objectiveStateVariant } from './labels';
	import type { ObjectiveCheckRow, ObjectiveStateRow } from './types';

	let {
		objectives,
		states,
		checks
	}: {
		/** The set frozen on the conversation, in the order it was frozen. */
		objectives: { key: string; label: string; description: string }[];
		states: ObjectiveStateRow[];
		/** Every rating ever logged, for every objective and every turn. */
		checks: ObjectiveCheckRow[];
	} = $props();

	function stateFor(key: string): ObjectiveStateRow['state'] {
		return states.find((row) => row.objective === key)?.state ?? 'unanswered';
	}

	// Newest turn first: the latest judgement is the one that decided what the
	// engine did next, and the older ones are there to show how it got there.
	function checksFor(key: string): ObjectiveCheckRow[] {
		return checks
			.filter((check) => check.objective === key)
			.sort((a, b) => b.turnNumber - a.turnNumber);
	}

	/** Cleared the bar, or did not. Weight only. */
	function thresholdClass(value: number, threshold: number): string {
		return value >= threshold ? 'font-medium' : 'text-muted-foreground';
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.checkinObjectives_title()}</Card.Title>
		<Card.Description>{m.checkinObjectives_body()}</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-6">
		{#each objectives as objective (objective.key)}
			{@const state = stateFor(objective.key)}
			{@const ratings = checksFor(objective.key)}
			<section class="flex flex-col gap-2">
				<div class="flex flex-wrap items-center gap-2">
					<h3 class="text-sm font-semibold">{objective.label}</h3>
					<Badge variant={objectiveStateVariant(state)}>{objectiveStateLabel(state)}</Badge>
				</div>
				<!-- The description is the ONLY text about this objective the judge
				     ever saw, so it is shown verbatim rather than paraphrased. -->
				<p class="text-muted-foreground text-xs">{objective.description}</p>

				{#if ratings.length > 0}
					<ol class="flex flex-col gap-2">
						{#each ratings as check (check._id)}
							<li class="border-border rounded-md border p-3">
								<div
									class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
								>
									<span>{m.checkinObjectives_turn({ number: check.turnNumber })}</span>
									<span>
										{m.checkinObjectives_rating()}
										<span class={thresholdClass(check.rating, RATING_ANSWERED)}>
											{asPercent(check.rating)}
										</span>
									</span>
									<span>
										{m.checkinObjectives_confidence()}
										<span class={thresholdClass(check.confidence, CONFIDENCE_ACCEPT)}>
											{asPercent(check.confidence)}
										</span>
									</span>
								</div>
								<!--
									`answer` is nullable ON PURPOSE: the judge returns null rather
									than inventing something the family did not say. That refusal
									is the anti-fabrication guarantee of the whole feature, so it
									is rendered as its own sentence — never as an empty cell,
									which would read as a rendering bug and lose the signal.
								-->
								{#if check.answer === null}
									<p class="text-muted-foreground mt-2 text-sm italic">
										{m.checkinObjectives_noAnswer()}
									</p>
								{:else}
									<p class="mt-2 text-sm">{check.answer}</p>
								{/if}
							</li>
						{/each}
					</ol>
				{:else}
					<p class="text-muted-foreground text-sm italic">{m.checkinObjectives_noAnswer()}</p>
				{/if}
			</section>
		{/each}
	</Card.Content>
</Card.Root>
