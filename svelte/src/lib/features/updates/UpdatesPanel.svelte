<script lang="ts">
	// ============================================================
	// Updates, for a campaign or for a project
	// ============================================================
	// ONE panel serves both parents. A campaign update and a project update are
	// the same row differing only in whether `projectId` is set, so the parent
	// arrives as a prop and everything downstream — the query, the capability,
	// the mutations — is chosen from it. Two near-identical lists would be two
	// places for the publish gate to drift out of agreement, and the publish gate
	// is this feature's safety control.
	//
	// THE CAPABILITY SPLIT. Writing rides the parent's own capability, exactly as
	// `updateWriteCapability` decides it on the server: `projects:write` for a
	// project post, `campaign:edit` for a campaign one. Publishing is
	// `content:publish`, which a team leader does not hold, because free prose
	// about a named family cannot be policed by a denylist and a second pair of
	// eyes is the only real control. So a writer without it sees the editor and
	// the save button, sees no publish or unpublish control anywhere, and is told
	// plainly who does publish.
	//
	// `access.can()` reads the same rules the Convex functions enforce, so a
	// hidden control and a rejected mutation can never disagree.
	// ============================================================

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import { getAccessContext } from '$lib/access';
	import type { Capability } from '$lib/domain/permissions';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import UpdateEditorDialog from './UpdateEditorDialog.svelte';
	import UpdateRow from './UpdateRow.svelte';
	import type { AdminUpdate } from './types';
	import * as m from '$lib/i18n/messages';

	let {
		campaignId,
		projectId
	}: {
		campaignId: Id<'campaigns'>;
		/** Set on a project's tab, absent on the campaign card. */
		projectId?: Id<'projects'>;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();
	const access = getAccessContext();

	// Both reads are declared, and exactly one of them is ever live: a query
	// cannot be created conditionally, so the parent picks which one runs by
	// skipping the other.
	const projectResponse = useQuery(api.updates.queries.listUpdatesForProject, () =>
		projectId ? { projectId } : 'skip'
	);
	const campaignResponse = useQuery(api.updates.queries.listUpdatesForCampaign, () =>
		projectId ? 'skip' : { campaignId }
	);

	const response = $derived(projectId ? projectResponse : campaignResponse);
	// Drafts and published posts together, which is what these admin queries
	// return and what the public ones deliberately do not.
	const updates = $derived(response.data ?? []);

	// The mirror of `updateWriteCapability` on the server: an update is governed
	// by the thing it is about, not by the caller's role.
	const writeCapability = $derived<Capability>(projectId ? 'projects:write' : 'campaign:edit');
	const canWrite = $derived(access.can(writeCapability, campaignId));
	const canPublish = $derived(access.can('content:publish', campaignId));

	let editorOpen = $state(false);
	let editing = $state<AdminUpdate | null>(null);
	let deleteOpen = $state(false);
	let deleting = $state<AdminUpdate | null>(null);
	// The row a mutation is currently in flight for, which doubles as the guard
	// against a second click landing on top of the first.
	let busyId = $state<string | null>(null);

	function openEditor(update: AdminUpdate | null): void {
		editing = update;
		editorOpen = true;
	}

	function openDelete(update: AdminUpdate): void {
		deleting = update;
		deleteOpen = true;
	}

	async function setPublished(update: AdminUpdate, publish: boolean): Promise<void> {
		if (busyId) return;
		busyId = update._id;
		try {
			if (publish) {
				// The server refuses to read the clock, so the moment comes from here
				// and is stored explicitly. A publish date can then never quietly turn
				// out to be a creation date.
				await client.mutation(api.updates.mutations.publishUpdate, {
					updateId: update._id,
					publishedAt: Date.now()
				});
				toast.success(m.updates_published());
			} else {
				await client.mutation(api.updates.mutations.unpublishUpdate, { updateId: update._id });
				toast.success(m.updates_unpublished());
			}
		} catch (error: unknown) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.updates_publishFailed());
		} finally {
			busyId = null;
		}
	}

	async function confirmDelete(): Promise<void> {
		const target = deleting;
		if (!target) return;
		try {
			await client.mutation(api.updates.mutations.deleteUpdate, { updateId: target._id });
			toast.success(m.updates_deleted());
		} catch (error: unknown) {
			// Rethrown rather than swallowed so the confirm dialog stays open with the
			// reason on it. A delete takes the photographs with it, and someone who
			// asked for that has to be able to read why it did not happen.
			throw new Error(
				error instanceof ConvexError ? String(error.data) : m.updates_deleteFailed(),
				{ cause: error }
			);
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.updates_title()}</Card.Title>
		{#if canWrite && !canPublish}
			<!-- Said out loud rather than left as a missing button: the person who
			writes the post is not the person who decides it goes public, and a
			writer who does not know that reads the absence as a bug. -->
			<Card.Description>{m.updates_cannotPublish()}</Card.Description>
		{/if}
		{#if canWrite}
			<Card.Action>
				<Button variant="outline" size="sm" onclick={() => openEditor(null)}>
					<PlusIcon class="size-4" aria-hidden="true" />
					{m.updates_new()}
				</Button>
			</Card.Action>
		{/if}
	</Card.Header>
	<Card.Content>
		{#if response.isLoading}
			<div class="flex flex-col gap-3">
				<Skeleton class="h-16 w-full" />
				<Skeleton class="h-16 w-full" />
			</div>
		{:else if updates.length === 0}
			<EmptyState variant="plain" size="sm" title={m.updates_empty()} />
		{:else}
			<div class="flex flex-col gap-3">
				{#each updates as update (update._id)}
					<UpdateRow
						{update}
						{canWrite}
						{canPublish}
						busy={busyId === update._id}
						onEdit={() => openEditor(update)}
						onPublish={() => setPublished(update, true)}
						onUnpublish={() => setPublished(update, false)}
						onDelete={() => openDelete(update)}
					/>
				{/each}
			</div>
		{/if}
	</Card.Content>
</Card.Root>

<UpdateEditorDialog bind:open={editorOpen} {campaignId} {projectId} update={editing} {canWrite} />

<ConfirmDialog
	bind:open={deleteOpen}
	title={m.updates_delete()}
	body={m.updates_deleteConfirm()}
	onConfirm={confirmDelete}
/>
