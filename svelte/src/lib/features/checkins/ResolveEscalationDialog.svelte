<script lang="ts">
	// Closing an escalation out. The note is the only prose this whole feature
	// stores that a person wrote rather than a model, and it is the charity's
	// record of what it actually did about a family in trouble — so it gets a
	// dialog of its own rather than an inline field that can be tabbed past.
	//
	// Optional, though. Someone marking a thing handled at 11pm from a phone
	// should not be blocked because they cannot yet write the paragraph, and a
	// forced field mostly produces "done".

	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import { Button } from '$lib/primitives/ui/button';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';

	let {
		open = $bindable(false),
		escalationId
	}: {
		open?: boolean;
		escalationId: Id<'checkinEscalations'>;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let note = $state('');
	let isSaving = $state(false);

	$effect(() => {
		if (!open) return;
		note = '';
	});

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving) return;
		isSaving = true;

		try {
			await client.mutation(api.checkins.mutations.resolveEscalation, {
				escalationId,
				// Omitted when blank rather than sent as `''`. This is a create-shaped
				// write — the note did not exist before — so an absent argument is the
				// house way to say "nothing to record", and `null` is reserved for
				// clearing something that was there.
				note: note.trim() || undefined,
				now: Date.now()
			});
			toast.success(m.escalation_resolved());
			open = false;
		} catch (error: unknown) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-lg">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.escalation_resolveTitle()}</Dialog.Title>
			<Dialog.Description>{m.escalation_resolveBody()}</Dialog.Description>
		</Dialog.Header>

		<form class="flex w-full flex-col gap-4" onsubmit={handleSubmit}>
			<div class="flex flex-col gap-2">
				<Label for="resolve-escalation-note">{m.escalation_resolveNote()}</Label>
				<Textarea id="resolve-escalation-note" bind:value={note} rows={4} />
			</div>

			<Dialog.Footer class="w-full">
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving}>
					{m.escalation_resolve()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
