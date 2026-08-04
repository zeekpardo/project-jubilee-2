<script lang="ts">
	// One post in the list, for either parent. It renders no prose: the body is
	// markdown whose images are storage-id directives, and resolving those to
	// pictures is the public renderer's job, not a list row's.
	//
	// The row holds no mutations either. Everything it can do is a callback, so
	// the busy state and the error handling live once, in the panel.

	// Primitives
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import type { AdminUpdate } from './types';
	import * as m from '$lib/i18n/messages';

	let {
		update,
		canWrite,
		canPublish,
		busy = false,
		onEdit,
		onPublish,
		onUnpublish,
		onDelete
	}: {
		update: AdminUpdate;
		canWrite: boolean;
		/** `content:publish`, which a team leader does not hold. */
		canPublish: boolean;
		busy?: boolean;
		onEdit: () => void;
		onPublish: () => void;
		onUnpublish: () => void;
		onDelete: () => void;
	} = $props();

	const isPublished = $derived(update.status === 'published');

	// A published post shows the moment it became public, which the server stores
	// explicitly; a draft has none, so it shows when it was written instead. The
	// two are never conflated — that is the whole reason `publishedAt` is passed
	// in rather than read from the clock.
	const shownAt = $derived(
		isPublished && update.publishedAt !== undefined ? update.publishedAt : update._creationTime
	);
</script>

<div class="border-border flex flex-wrap items-start justify-between gap-3 rounded-md border p-4">
	<div class="flex min-w-0 flex-col gap-1">
		<div class="flex flex-wrap items-center gap-2">
			<span class="font-medium">{update.title}</span>
			<Badge variant={isPublished ? 'success' : 'secondary'}>
				{isPublished ? m.updates_statusPublished() : m.updates_statusDraft()}
			</Badge>
		</div>
		<span class="text-muted-foreground text-xs tabular-nums">
			{new Date(shownAt).toLocaleDateString()}
		</span>
	</div>

	<div class="flex flex-wrap items-center gap-2">
		{#if canWrite}
			<Button variant="outline" size="sm" disabled={busy} onclick={onEdit}>
				<PencilIcon class="size-4" aria-hidden="true" />
				{m.updates_edit()}
			</Button>
		{/if}

		<!-- Publish and unpublish appear only for `content:publish`. A writer
		without it sees this row exactly as it is, minus these two buttons, and the
		panel tells them who does the publishing. -->
		{#if canPublish}
			{#if isPublished}
				<Button variant="outline" size="sm" disabled={busy} onclick={onUnpublish}>
					{m.updates_unpublish()}
				</Button>
			{:else}
				<Button size="sm" disabled={busy} onclick={onPublish}>
					{m.updates_publish()}
				</Button>
			{/if}
		{/if}

		{#if canWrite}
			<Button
				variant="ghost"
				size="icon"
				disabled={busy}
				aria-label={m.updates_delete()}
				title={m.updates_delete()}
				onclick={onDelete}
			>
				<Trash2Icon class="size-4" aria-hidden="true" />
			</Button>
		{/if}
	</div>
</div>
