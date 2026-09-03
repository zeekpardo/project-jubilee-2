<script lang="ts">
	// What the drafted update is made of.
	//
	// Every section here becomes a REQUIRED property on the `draft_update`
	// tool — that is the whole reason the format is a schema rather than a
	// paragraph of instructions. There is deliberately no "optional section"
	// switch: a reviewer reading a draft cannot tell a section the model chose
	// to omit from one the conversation had nothing to fill it with, so a
	// skippable section says so in its own guidance and lets the model write
	// "nothing to report", which is a fact rather than an absence.

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	import { blankSection, numberText, optionalNumber, type WorkflowDraft } from './types';
	import * as m from '$lib/i18n/messages';

	let { draft }: { draft: WorkflowDraft } = $props();
</script>

<div class="flex flex-col gap-4">
	<Card.Root>
		<Card.Header>
			<Card.Title>{m.workflows_report_title()}</Card.Title>
			<Card.Description>{m.workflows_report_body()}</Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-col gap-4">
			<div class="flex flex-col gap-2">
				<Label for="report-title-guidance">{m.workflows_titleGuidance()}</Label>
				<Input
					id="report-title-guidance"
					bind:value={draft.report.titleGuidance}
					autocomplete="off"
				/>
				<p class="text-muted-foreground text-xs">{m.workflows_titleGuidanceHelp()}</p>
			</div>
			<div class="flex flex-col gap-2">
				<Label for="report-instructions">{m.workflows_instructions()}</Label>
				<Textarea id="report-instructions" bind:value={draft.report.instructions} rows={4} />
				<!-- House style, not ethics. What the drafter may say about a family
				     lives in its prompt, one tab over, and changes carefully. -->
				<p class="text-muted-foreground text-xs">{m.workflows_instructionsHelp()}</p>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>{m.workflows_sections()}</Card.Title>
			<Card.Description>{m.workflows_sectionsBody()}</Card.Description>
			<Card.Action>
				<Button
					variant="outline"
					size="sm"
					onclick={() => draft.report.sections.push(blankSection())}
				>
					<PlusIcon class="size-4" aria-hidden="true" />
					{m.workflows_addSection()}
				</Button>
			</Card.Action>
		</Card.Header>
		<Card.Content class="flex flex-col gap-4">
			{#if draft.report.sections.length === 0}
				<p class="text-muted-foreground text-sm">{m.workflows_sectionsEmpty()}</p>
			{:else}
				{#each draft.report.sections as section, index (index)}
					<div class="border-border flex flex-col gap-4 rounded-lg border p-4">
						<div class="grid gap-4 sm:grid-cols-3">
							<div class="flex flex-col gap-2">
								<Label for={`section-${index}-key`}>{m.workflows_sectionKey()}</Label>
								<Input
									id={`section-${index}-key`}
									class="font-mono text-xs"
									bind:value={section.key}
									autocomplete="off"
								/>
								<p class="text-muted-foreground text-xs">{m.workflows_sectionKeyHelp()}</p>
							</div>
							<div class="flex flex-col gap-2">
								<Label for={`section-${index}-label`}>{m.workflows_sectionLabel()}</Label>
								<Input
									id={`section-${index}-label`}
									bind:value={section.label}
									autocomplete="off"
								/>
								<p class="text-muted-foreground text-xs">{m.workflows_sectionLabelHelp()}</p>
							</div>
							<div class="flex flex-col gap-2">
								<Label for={`section-${index}-words`}>{m.workflows_sectionWords()}</Label>
								<!-- Blank is "no steer", not "zero words". -->
								<Input
									id={`section-${index}-words`}
									type="number"
									min={1}
									step="10"
									inputmode="numeric"
									value={numberText(section.approxWords)}
									oninput={(event) => {
										section.approxWords = optionalNumber(event.currentTarget.value);
									}}
								/>
								<p class="text-muted-foreground text-xs">{m.workflows_sectionWordsHelp()}</p>
							</div>
						</div>

						<div class="flex flex-col gap-2">
							<Label for={`section-${index}-guidance`}>{m.workflows_sectionGuidance()}</Label>
							<Textarea id={`section-${index}-guidance`} bind:value={section.guidance} rows={3} />
							<p class="text-muted-foreground text-xs">{m.workflows_sectionGuidanceHelp()}</p>
						</div>

						<div class="flex justify-end">
							<Button
								variant="ghost"
								size="sm"
								onclick={() => draft.report.sections.splice(index, 1)}
							>
								<TrashIcon class="size-4" aria-hidden="true" />
								{m.workflows_removeSection()}
							</Button>
						</div>
					</div>
				{/each}
			{/if}
		</Card.Content>
	</Card.Root>
</div>
