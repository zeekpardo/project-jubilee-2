<script lang="ts">
	// Recording a reply that ALREADY arrived, by some route this product does not
	// own yet.
	//
	// Read the labelling twice before changing any of it. This is not a reply box.
	// Staff do not speak to families through here, and nothing typed here is sent
	// anywhere — WhatsApp delivery is not built. What this writes is an INBOUND
	// message, stored as the family's own words, which is then scanned for
	// anything that needs a person and, if the conversation is still open, handed
	// to a model as though the family had said it.
	//
	// So a box labelled "Reply" would be wrong in the most expensive direction
	// available: a member of staff would type their own words into a field that
	// records them as the family's, and every rating, draft and escalation
	// downstream would treat staff speech as testimony.

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
		conversationId,
		open = $bindable(false)
	}: { conversationId: Id<'checkinConversations'>; open?: boolean } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let text = $state('');
	let isSaving = $state(false);

	const canSubmit = $derived(text.trim() !== '');

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;

		try {
			// The server refuses to read the clock, so the moment comes from here —
			// the same contract `publishUpdate` keeps.
			const result = await client.mutation(api.checkins.mutations.receiveMessage, {
				conversationId,
				text: text.trim(),
				now: Date.now()
			});
			// An escalation is not a quieter kind of success. It is the one outcome
			// where a person now has to do something, so it says so.
			toast.success(
				result.escalated ? m.checkinDetail_simulateEscalated() : m.checkinDetail_simulateRecorded()
			);
			text = '';
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
			<Dialog.Title>{m.checkinDetail_simulateTitle()}</Dialog.Title>
			<Dialog.Description>{m.checkinDetail_simulateBody()}</Dialog.Description>
		</Dialog.Header>

		<form class="flex w-full flex-col gap-4" onsubmit={handleSubmit}>
			<div class="flex flex-col gap-2">
				<Label for="checkin-inbound-text">{m.checkinDetail_simulateField()}</Label>
				<!-- A Textarea, not an Input: what a family writes back runs to
				     paragraphs, and a single-line box would invite it to be trimmed. -->
				<Textarea id="checkin-inbound-text" bind:value={text} rows={5} required />
			</div>

			<Dialog.Footer class="w-full">
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || !canSubmit}>
					{m.checkinDetail_simulateSubmit()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
