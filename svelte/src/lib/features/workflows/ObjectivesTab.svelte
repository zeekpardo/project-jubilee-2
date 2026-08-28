<script lang="ts">
	// The ordered steps, and what each answer is for.
	//
	// STEPS ARE A UNIT OF AUTHORING, not of execution — the engine flattens
	// every step into one outstanding set and lets the responder pick its own
	// order within it. The numbering here says "these four are the school
	// questions", it does not promise a family will be marched through them.

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import ObjectiveEditor from './ObjectiveEditor.svelte';
	import { blankObjective, blankStep, type WorkflowDraft } from './types';
	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	let { draft, campaignId }: { draft: WorkflowDraft; campaignId: Id<'campaigns'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();

	// Both entities, always. An objective can file its answer on the record or
	// on the contact and the author flips between the two inside one card, so
	// fetching on demand would put a spinner inside a select.
	const projectFieldsResponse = useQuery(api.customFields.queries.listFieldDefinitions, () =>
		auth.isAuthenticated ? { entity: 'project' as const, campaignId } : 'skip'
	);
	const contactFieldsResponse = useQuery(api.customFields.queries.listFieldDefinitions, () =>
		auth.isAuthenticated ? { entity: 'contact' as const, campaignId } : 'skip'
	);

	const projectFields = $derived(projectFieldsResponse.data ?? []);
	const contactFields = $derived(contactFieldsResponse.data ?? []);

	function addStep(): void {
		draft.steps.push(blankStep(draft.steps.length));
	}

	function removeStep(index: number): void {
		draft.steps.splice(index, 1);
	}
</script>

<div class="flex flex-col gap-4">
	{#if draft.steps.length === 0}
		<EmptyState title={m.workflows_stepsEmpty()} description={m.workflows_stepsEmptyBody()}>
			{#snippet icon()}
				<ListChecksIcon />
			{/snippet}
			{#snippet action()}
				<Button variant="outline" onclick={addStep}>
					<PlusIcon class="size-4" aria-hidden="true" />
					{m.workflows_addStep()}
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		{#each draft.steps as step, stepIndex (stepIndex)}
			<Card.Root>
				<Card.Header>
					<Card.Title>{m.workflows_step({ number: stepIndex + 1 })}</Card.Title>
					<Card.Action>
						<Button variant="ghost" size="sm" onclick={() => removeStep(stepIndex)}>
							<TrashIcon class="size-4" aria-hidden="true" />
							{m.workflows_removeStep()}
						</Button>
					</Card.Action>
				</Card.Header>
				<Card.Content class="flex flex-col gap-4">
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="flex flex-col gap-2">
							<Label for={`step-${stepIndex}-key`}>{m.workflows_stepKey()}</Label>
							<Input
								id={`step-${stepIndex}-key`}
								class="font-mono text-xs"
								bind:value={step.key}
								autocomplete="off"
							/>
						</div>
						<div class="flex flex-col gap-2">
							<Label for={`step-${stepIndex}-title`}>{m.workflows_stepTitle()}</Label>
							<Input id={`step-${stepIndex}-title`} bind:value={step.title} autocomplete="off" />
						</div>
					</div>

					<div class="flex flex-col gap-2">
						<Label for={`step-${stepIndex}-entry`}>{m.workflows_stepEntryMessage()}</Label>
						<Textarea id={`step-${stepIndex}-entry`} bind:value={step.entryMessage} rows={2} />
						<!-- Guidance, never a script. A verbatim line is how a warm
						     message becomes a form. -->
						<p class="text-muted-foreground text-xs">{m.workflows_stepEntryMessageHelp()}</p>
					</div>

					<div class="flex flex-col gap-3 border-t pt-4">
						<div class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
							{m.workflows_objectives()}
						</div>

						{#if step.objectives.length === 0}
							<p class="text-muted-foreground text-sm">{m.workflows_objectivesEmpty()}</p>
						{:else}
							{#each step.objectives as objective, objectiveIndex (objectiveIndex)}
								<ObjectiveEditor
									{objective}
									id={`objective-${stepIndex}-${objectiveIndex}`}
									{projectFields}
									{contactFields}
									onRemove={() => step.objectives.splice(objectiveIndex, 1)}
								/>
							{/each}
						{/if}

						<div>
							<Button
								variant="outline"
								size="sm"
								onclick={() => step.objectives.push(blankObjective())}
							>
								<PlusIcon class="size-4" aria-hidden="true" />
								{m.workflows_addObjective()}
							</Button>
						</div>
					</div>
				</Card.Content>
			</Card.Root>
		{/each}

		<div>
			<Button variant="outline" onclick={addStep}>
				<PlusIcon class="size-4" aria-hidden="true" />
				{m.workflows_addStep()}
			</Button>
		</div>
	{/if}
</div>
