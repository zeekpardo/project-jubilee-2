<script lang="ts">
	// The three voices, and they are this workflow's own.
	//
	// A trip debrief and a family check-in should not share a responder prompt:
	// the responder is where the care about who is being written to actually
	// lives. A new workflow is seeded with the shipped defaults server-side, so
	// these are a starting point rather than three empty boxes.

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import * as Select from '$lib/primitives/ui/select';
	import { createListCollection } from '@ark-ui/svelte/select';

	import { WORKFLOW_MODELS } from '$lib/domain/workflows';
	import type { WorkflowDraft } from './types';
	import { PROMPT_ROLES, promptRoleHelp, promptRoleLabel } from './labels';
	import * as m from '$lib/i18n/messages';

	let { draft }: { draft: WorkflowDraft } = $props();

	const modelLabel = (model: { label: string; inputPerMTok: number; outputPerMTok: number }) =>
		m.workflows_modelOption({
			name: model.label,
			input: model.inputPerMTok,
			output: model.outputPerMTok
		});

	/**
	 * The catalogue, plus whatever this workflow is actually on.
	 *
	 * A published workflow may name a model this build no longer lists — an id
	 * that has since been superseded, or a dated variant written before the
	 * catalogue existed. Dropping it would render an empty select and then
	 * silently rewrite the model on the next save, which is a configuration
	 * change nobody asked for. It stays, shown verbatim, until an author picks
	 * something else.
	 */
	const collectionFor = (current: string) => {
		const known = WORKFLOW_MODELS.map((model) => ({
			value: model.id,
			label: modelLabel(model)
		}));
		const listed = WORKFLOW_MODELS.some((model) => model.id === current);
		return createListCollection({
			items: current && !listed ? [...known, { value: current, label: current }] : known
		});
	};
</script>

<div class="flex flex-col gap-4">
	{#each PROMPT_ROLES as role (role)}
		<Card.Root>
			<Card.Header>
				<Card.Title>{promptRoleLabel(role)}</Card.Title>
				<Card.Description>{promptRoleHelp(role)}</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<div class="flex flex-col gap-2">
					<Label for={`prompt-${role}-model`}>{m.workflows_promptModel()}</Label>
					<Select.Root
						collection={collectionFor(draft.prompts[role].model)}
						value={[draft.prompts[role].model]}
						onValueChange={(details: { value: string[] }) => {
							// Ark fires with an empty array when a selection is cleared;
							// a workflow with no model cannot run, so ignore it.
							if (details.value[0]) draft.prompts[role].model = details.value[0];
						}}
					>
						<Select.Trigger
							id={`prompt-${role}-model`}
							class="w-full"
							placeholder={m.workflows_promptModel()}
						/>
						<Select.Content>
							{#each collectionFor(draft.prompts[role].model).items as item (item.value)}
								<Select.Item {item}>{item.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<p class="text-muted-foreground text-xs">{m.workflows_promptModelHelp()}</p>
				</div>
				<div class="flex flex-col gap-2">
					<Label for={`prompt-${role}-content`}>{m.workflows_promptContent()}</Label>
					<!-- Monospaced and tall: this is the literal text a model receives,
					     and its whitespace is load-bearing — which is also why the save
					     path does not trim it. -->
					<Textarea
						id={`prompt-${role}-content`}
						bind:value={draft.prompts[role].content}
						rows={14}
						class="font-mono text-xs"
					/>
				</div>
			</Card.Content>
		</Card.Root>
	{/each}
</div>
