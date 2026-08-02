<script lang="ts">
	// ============================================================
	// Saved views — the URL, named
	// ============================================================
	// A view stores the QUERY STRING and nothing else, so applying one is a
	// navigation and not a second filter state to keep in step. That is the whole
	// reason filters live in the URL: "save this view" is "remember this link",
	// and every filter added to the parser is saveable the day it lands, with no
	// change here.
	//
	// So this component never parses a view in order to apply it. It hands the
	// stored string to the parent, which navigates; `parseTaskQuery` then runs
	// where it always runs, on `page.url`.
	// ============================================================

	// Primitives
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import * as Dialog from '$lib/primitives/ui/dialog';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import * as Menu from '$lib/primitives/ui/menu';
	import { Switch } from '$lib/primitives/ui/switch';
	import { Portal } from '@ark-ui/svelte';
	import BookmarkIcon from '@lucide/svelte/icons/bookmark';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient, useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import { getAccessContext } from '$lib/access';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import { parseTaskQuery, serializeTaskFilters } from './filters';
	import type { TaskFilters } from './types';
	import * as m from '$lib/i18n/messages';

	let {
		filters,
		onApply
	}: {
		filters: TaskFilters;
		/** The stored query string, verbatim. The parent owns navigation. */
		onApply: (query: string) => void;
	} = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();
	const access = getAccessContext();

	const viewsResponse = useQuery(api.tasks.queries.listTaskViews, () =>
		auth.isAuthenticated ? {} : 'skip'
	);
	const views = $derived(viewsResponse.data ?? []);

	/** Publishing a view org-wide is a settings decision. The backend enforces it too. */
	const canShare = $derived(access.can('settings:manage'));

	const currentQuery = $derived(serializeTaskFilters(filters));

	/**
	 * Which view the URL is currently showing, if any.
	 *
	 * Both sides are normalised through the parser rather than compared as raw
	 * strings: a view saved by an older build, or a link someone hand-edited,
	 * describes the same filters in a different spelling, and a view that stops
	 * recognising itself after a URL round trip is worse than no highlight.
	 */
	const activeViewId = $derived(
		views.find((view) => serializeTaskFilters(parseTaskQuery(view.query)) === currentQuery)?._id ??
			null
	);

	// ------------------------------------------------------------------
	// The name dialog, for both saving and renaming
	// ------------------------------------------------------------------
	// One dialog, because the fields are the same two and the difference is which
	// mutation runs. Splitting it would duplicate the sharing control, which is
	// the only part with a rule attached.

	let editing = $state<{ _id: Id<'taskViews'>; name: string; isShared: boolean } | null>(null);
	let dialogOpen = $state(false);
	let name = $state('');
	let isShared = $state(false);
	let isSaving = $state(false);

	function openSave(): void {
		editing = null;
		name = '';
		isShared = false;
		dialogOpen = true;
	}

	function openRename(view: { _id: Id<'taskViews'>; name: string; isShared: boolean }): void {
		editing = view;
		name = view.name;
		isShared = view.isShared;
		dialogOpen = true;
	}

	function reportError(error: unknown): void {
		toast.error(
			error instanceof ConvexError
				? String(error.data)
				: error instanceof Error
					? error.message
					: m.state_saveFailed()
		);
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !name.trim()) return;
		isSaving = true;
		try {
			if (editing) {
				await client.mutation(api.tasks.mutations.setTaskViewQuery, {
					taskViewId: editing._id,
					name: name.trim(),
					isShared
				});
				toast.success(m.taskList_viewUpdated());
			} else {
				// The query the user is LOOKING at, serialised by the same function
				// that writes the address bar — so a view and its link are one string.
				await client.mutation(api.tasks.mutations.saveTaskView, {
					name: name.trim(),
					query: currentQuery,
					isShared
				});
				toast.success(m.taskList_viewSaved());
			}
			dialogOpen = false;
		} catch (error) {
			reportError(error);
		} finally {
			isSaving = false;
		}
	}

	// ------------------------------------------------------------------
	// Delete
	// ------------------------------------------------------------------

	let deleting = $state<{ _id: Id<'taskViews'>; name: string } | null>(null);
	let deleteOpen = $state(false);

	function openDelete(view: { _id: Id<'taskViews'>; name: string }): void {
		deleting = view;
		deleteOpen = true;
	}

	async function confirmDelete(): Promise<void> {
		if (!deleting) return;
		await client.mutation(api.tasks.mutations.deleteTaskView, { taskViewId: deleting._id });
		toast.success(m.taskList_viewDeleted());
	}
</script>

<div class="flex w-full flex-wrap items-center gap-2 p-1">
	<span class="text-muted-foreground text-xs">{m.taskList_savedViews()}</span>

	{#each views as view (view._id)}
		<div class="flex items-center">
			<Button
				size="sm"
				variant={activeViewId === view._id ? 'secondary' : 'ghost'}
				aria-pressed={activeViewId === view._id}
				aria-label={m.taskList_viewApply({ name: view.name })}
				onclick={() => onApply(view.query)}
			>
				{view.name}
				{#if view.isShared}
					<Badge variant="outline">{m.taskList_viewSharedBadge()}</Badge>
				{/if}
			</Button>

			<!-- Someone else's shared view is APPLY-ONLY. They published it; a
			     reader renaming it out from under them is not a shared view. -->
			{#if view.isOwn}
				<Menu.Root>
					<Menu.Trigger
						aria-label={m.taskList_viewActions({ name: view.name })}
						class="text-muted-foreground hover:text-foreground cursor-pointer rounded px-1"
					>
						<EllipsisIcon class="size-4" />
					</Menu.Trigger>
					<Portal>
						<Menu.Content class="w-40">
							<Menu.Item value="rename" onclick={() => openRename(view)}>
								<PencilIcon />
								{m.taskList_viewRename()}
							</Menu.Item>
							<Menu.Item value="delete" variant="destructive" onclick={() => openDelete(view)}>
								<Trash2Icon />
								{m.action_delete()}
							</Menu.Item>
						</Menu.Content>
					</Portal>
				</Menu.Root>
			{/if}
		</div>
	{/each}

	<Button size="sm" variant="outline" onclick={openSave}>
		<BookmarkIcon aria-hidden="true" />
		{m.taskList_viewSave()}
	</Button>
</div>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content class="md:max-w-md">
		<Dialog.Header class="w-full">
			<Dialog.Title>
				{editing ? m.taskList_viewEditTitle() : m.taskList_viewSaveTitle()}
			</Dialog.Title>
			{#if !editing}
				<Dialog.Description>{m.taskList_viewSaveBody()}</Dialog.Description>
			{/if}
		</Dialog.Header>

		<form onsubmit={submit} class="flex w-full flex-col gap-4">
			<div class="flex flex-col gap-2">
				<Label for="task-view-name">{m.field_name()}</Label>
				<Input id="task-view-name" bind:value={name} required />
			</div>

			<!-- Hidden rather than disabled without `settings:manage`: a control that
			     cannot be used is a question the reader has to answer for themselves. -->
			{#if canShare}
				<div class="flex flex-col gap-2">
					<Switch bind:checked={isShared}>{m.taskList_viewShare()}</Switch>
					<p class="text-muted-foreground text-xs">{m.taskList_viewShareHelp()}</p>
				</div>
			{/if}

			<Dialog.Footer class="w-full">
				<Button
					type="button"
					variant="outline"
					onclick={() => (dialogOpen = false)}
					disabled={isSaving}
				>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || !name.trim()}>
					{m.action_save()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>

<ConfirmDialog
	bind:open={deleteOpen}
	title={m.taskList_viewDeleteTitle()}
	body={deleting ? m.taskList_viewDeleteBody({ name: deleting.name }) : ''}
	onConfirm={confirmDelete}
/>
