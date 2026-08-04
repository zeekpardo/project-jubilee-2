<script lang="ts">
	// Writing an update, for either parent. The only difference between a
	// campaign post and a project one is whether `projectId` is set, and it is
	// passed straight through to every mutation, which is what lets the same
	// dialog serve both screens.
	//
	// There is no publish control anywhere in here, on purpose. Saving is the
	// writer's decision and publishing is somebody else's, so the two never share
	// a button — see UpdatesPanel.svelte for the capability split.

	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import { RichTextEditor } from '$lib/features/rich-text';
	import { referencedAssetIds } from './assets';
	import type { AdminUpdate } from './types';
	import * as m from '$lib/i18n/messages';

	let {
		open = $bindable(false),
		campaignId,
		projectId,
		update = null,
		canWrite
	}: {
		open?: boolean;
		campaignId: Id<'campaigns'>;
		/** Set for a project update, absent for a campaign one. */
		projectId?: Id<'projects'>;
		/** The post being edited, or null to write a new one. */
		update?: AdminUpdate | null;
		canWrite: boolean;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let title = $state('');
	let body = $state('');
	let isSaving = $state(false);

	/**
	 * Every storage id this dialog has ever attached to the post — the ones it
	 * loaded plus the ones it uploaded. This is the accumulator; what actually
	 * gets saved is the subset the body still names, see `referencedAssetIds`.
	 */
	let assetIds = $state<Id<'_storage'>[]>([]);

	// Which post the fields currently hold. Deliberately NOT `$state`: the effect
	// below reads the live `update` prop, which the list query re-issues on every
	// change, and a reactive guard would make the effect depend on its own write.
	// A plain variable makes the seed happen exactly once per opening.
	let seededFor: string | null = null;

	$effect(() => {
		if (!open) {
			seededFor = null;
			return;
		}
		const key = update?._id ?? 'new';
		// A live query result arriving mid-edit must never overwrite what someone
		// is in the middle of typing, so the fields are seeded only when the dialog
		// opens on a different post than the one already loaded.
		if (seededFor === key) return;
		seededFor = key;
		title = update?.title ?? '';
		body = update?.body ?? '';
		assetIds = update ? [...update.assetIds] : [];
	});

	const canSubmit = $derived(canWrite && title.trim() !== '');

	/**
	 * The established three-step upload: a capability-gated mutation mints a
	 * short-lived signed URL, the browser POSTs the bytes straight to it, and only
	 * the returned storage id comes back here.
	 *
	 * The id is recorded before it is handed to the editor, because that array is
	 * the only handle anything will ever have on the blob. If the writer abandons
	 * the dialog the blob is orphaned rather than leaked — nothing names it, so
	 * nothing can resolve it — which is the safe end of that trade.
	 */
	async function uploadImage(file: File): Promise<string> {
		const uploadUrl = await client.mutation(api.updates.mutations.generateUpdateImageUploadUrl, {
			campaignId,
			projectId
		});
		const response = await fetch(uploadUrl, {
			method: 'POST',
			headers: { 'Content-Type': file.type },
			body: file
		});
		// The bytes must land before anything points at them, so a failed POST
		// throws here instead of returning an id for a blob that does not exist.
		if (!response.ok) throw new Error(m.updates_uploadFailed());
		const payload = (await response.json()) as { storageId: Id<'_storage'> };

		assetIds = [...assetIds, payload.storageId];
		return payload.storageId;
	}

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;

		try {
			const kept = referencedAssetIds(body, assetIds);

			if (update) {
				await client.mutation(api.updates.mutations.updateUpdate, {
					updateId: update._id,
					title: title.trim(),
					body,
					assetIds: kept
				});
			} else {
				// Always a draft. The mutation has no publish argument at all, so
				// there is nothing to pass and nothing to get wrong here.
				await client.mutation(api.updates.mutations.createUpdate, {
					campaignId,
					projectId,
					title: title.trim(),
					body,
					assetIds: kept
				});
			}

			// The server has now deleted whatever fell out of the array, so keeping
			// the dropped ids would leave this dialog holding handles to blobs that
			// no longer exist.
			assetIds = kept;
			toast.success(m.updates_saved());
			open = false;
		} catch (error: unknown) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.updates_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-3xl">
		<Dialog.Header class="w-full">
			<Dialog.Title>{update ? m.updates_edit() : m.updates_new()}</Dialog.Title>
		</Dialog.Header>

		<form onsubmit={save} class="flex w-full flex-col gap-4">
			<div class="flex flex-col gap-2">
				<Label for="update-title">{m.updates_fieldTitle()}</Label>
				<Input id="update-title" bind:value={title} autocomplete="off" disabled={!canWrite} />
			</div>

			<div class="flex flex-col gap-2">
				<Label for="update-body">{m.updates_fieldBody()}</Label>
				<RichTextEditor bind:value={body} onUploadImage={uploadImage} disabled={!canWrite} />
				<p class="text-muted-foreground text-xs">{m.updates_bodyHint()}</p>
			</div>

			<Dialog.Footer class="w-full">
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || !canSubmit}>
					{m.updates_save()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
