<script lang="ts">
	// Writing to whoever this conversation is with, in your own words.
	//
	// NOT the same control as ManualInboundDialog, and the difference is the
	// whole point of having two. That one records what the OTHER side already
	// said, as their testimony. This one writes an OUTBOUND message a member of
	// staff is the author of — `sendMessage` stamps it with their user id, which
	// is what lets the transcript tell a colleague's words from a model's.
	//
	// THE DRAFT SURVIVES A FAILURE. There is no `finally { draft = '' }` here on
	// purpose: the most likely refusal is "a check-in is running on this
	// conversation", and clearing the box on the way to that toast would delete a
	// paragraph somebody just wrote for a reason that has nothing to do with what
	// they wrote. It is cleared only once the server has it.
	//
	// When the composer cannot be used, it is replaced by the reason rather than
	// disabled in place. A box that accepts typing and refuses on submit teaches
	// the rule at the most expensive moment available.

	// Primitives
	import { Button } from '$lib/primitives/ui/button';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import SendIcon from '@lucide/svelte/icons/send';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';

	let {
		conversationId,
		disabled = false,
		disabledReason
	}: {
		conversationId: Id<'checkinConversations'>;
		/** True when the mutation would refuse. Say why. */
		disabled?: boolean;
		disabledReason?: string;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let draft = $state('');
	let isSending = $state(false);

	const canSend = $derived(!disabled && !isSending && draft.trim() !== '');

	async function send(): Promise<void> {
		if (!canSend) return;
		isSending = true;

		try {
			await client.mutation(api.checkins.mutations.sendMessage, {
				conversationId,
				text: draft.trim(),
				// The server refuses to read the clock, so the moment comes from here.
				now: Date.now()
			});
			toast.success(m.checkinCompose_sent());
			// Only now, and deliberately not in a `finally`. See the header.
			draft = '';
		} catch (error: unknown) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSending = false;
		}
	}

	function handleSubmit(event: SubmitEvent): void {
		event.preventDefault();
		void send();
	}

	// Enter sends, Shift+Enter breaks the line. A message to a family runs to
	// paragraphs often enough that the newline has to stay reachable.
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void send();
	}
</script>

{#if disabled && disabledReason}
	<p class="text-muted-foreground text-xs">{disabledReason}</p>
{:else}
	<form
		class="border-border bg-card flex items-end gap-2 rounded-lg border p-3"
		onsubmit={handleSubmit}
	>
		<Textarea
			bind:value={draft}
			rows={2}
			class="resize-none"
			placeholder={m.checkinCompose_placeholder()}
			aria-label={m.checkinCompose_placeholder()}
			{disabled}
			onkeydown={handleKeydown}
		/>
		<Button type="submit" size="icon" loading={isSending} disabled={!canSend}>
			<SendIcon aria-hidden="true" />
			<span class="sr-only">{m.checkinCompose_send()}</span>
		</Button>
	</form>
{/if}
