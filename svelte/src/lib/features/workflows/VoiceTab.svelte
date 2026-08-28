<script lang="ts">
	// The three voices, and they are this workflow's own.
	//
	// A trip debrief and a family check-in should not share a responder prompt:
	// the responder is where the care about who is being written to actually
	// lives. A new workflow is seeded with the shipped defaults server-side, so
	// these are a starting point rather than three empty boxes.

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';

	import type { WorkflowDraft } from './types';
	import { PROMPT_ROLES, promptRoleHelp, promptRoleLabel } from './labels';
	import * as m from '$lib/i18n/messages';

	let { draft }: { draft: WorkflowDraft } = $props();
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
					<Input
						id={`prompt-${role}-model`}
						class="font-mono text-xs"
						bind:value={draft.prompts[role].model}
						autocomplete="off"
					/>
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
