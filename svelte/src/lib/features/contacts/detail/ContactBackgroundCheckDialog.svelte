<script lang="ts">
	import * as Dialog from '$lib/primitives/ui/dialog';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Switch } from '$lib/primitives/ui/switch';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';
	import type { ContactBackgroundCheckRow } from './types';

	let {
		open = $bindable(false),
		contactId,
		check = null
	}: {
		open?: boolean;
		contactId: Id<'contacts'>;
		/** Null adds, a row edits. */
		check?: ContactBackgroundCheckRow | null;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const isEdit = $derived(check !== null);

	let cleared = $state(false);
	let completedOn = $state('');
	let expiresOn = $state('');
	let note = $state('');
	let isSaving = $state(false);

	$effect(() => {
		if (!open) return;
		cleared = check?.cleared ?? false;
		completedOn = check?.completedOn ?? '';
		expiresOn = check?.expiresOn ?? '';
		note = check?.note ?? '';
	});

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving) return;
		isSaving = true;

		try {
			if (check) {
				await client.mutation(api.contacts.mutations.updateBackgroundCheck, {
					checkId: check._id,
					cleared,
					completedOn: completedOn.trim(),
					expiresOn: expiresOn.trim(),
					note: note.trim()
				});
			} else {
				await client.mutation(api.contacts.mutations.addBackgroundCheck, {
					contactId,
					cleared,
					completedOn: completedOn.trim() || undefined,
					expiresOn: expiresOn.trim() || undefined,
					note: note.trim() || undefined
				});
			}
			toast.success(m.contactDetail_backgroundCheckSaved());
			open = false;
		} catch (error: unknown) {
			toast.error(
				error instanceof ConvexError
					? String(error.data)
					: error instanceof Error
						? error.message
						: m.state_saveFailed()
			);
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header class="w-full">
			<Dialog.Title>
				{isEdit ? m.contactDetail_editBackgroundCheck() : m.contactDetail_addBackgroundCheck()}
			</Dialog.Title>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<Switch bind:checked={cleared}>{m.contactDetail_cleared()}</Switch>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="check-completed">{m.contactDetail_completedOn()}</Label>
					<Input id="check-completed" type="date" bind:value={completedOn} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="check-expires">{m.contactDetail_expiresOn()}</Label>
					<Input id="check-expires" type="date" bind:value={expiresOn} />
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="check-note">{m.field_notes()}</Label>
				<Textarea id="check-note" bind:value={note} rows={3} />
			</div>

			<Dialog.Footer class="w-full">
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving}>
					{isEdit ? m.action_save() : m.action_add()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
