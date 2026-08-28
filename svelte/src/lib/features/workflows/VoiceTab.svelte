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
	import type { PromptRole } from './types';
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
	/**
	 * One STABLE collection per role.
	 *
	 * Built in a `$derived` rather than called inline in the markup, and that is
	 * load-bearing: `createListCollection` returns a new object every call, so an
	 * inline call handed `Select.Root` and the `{#each}` two different
	 * collections and made a fresh one on every render. Ark keeps its open/highlight
	 * state against the collection it was given, so the menu simply never opened.
	 *
	 * Each list is the catalogue plus whatever this workflow is actually on. A
	 * published workflow may name a model this build no longer lists — an id
	 * since superseded, or a dated snapshot written before the catalogue existed.
	 * Dropping it would render an empty select and then silently rewrite the
	 * model on the next save, which is a configuration change nobody asked for.
	 */
	const collections = $derived(
		Object.fromEntries(
			PROMPT_ROLES.map((role) => {
				const current = draft.prompts[role].model;
				const known = WORKFLOW_MODELS.map((model) => ({
					value: model.id,
					label: modelLabel(model)
				}));
				const listed = WORKFLOW_MODELS.some((model) => model.id === current);
				return [
					role,
					createListCollection({
						items: current && !listed ? [...known, { value: current, label: current }] : known
					})
				];
			})
		) as Record<
			PromptRole,
			ReturnType<typeof createListCollection<{ value: string; label: string }>>
		>
	);
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
						collection={collections[role]}
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
							{#each collections[role].items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
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
