<script lang="ts">
	// One workflow, whole, on one page.
	//
	// FULL PAGE, NOT A DIALOG. This surface is a repeater of repeaters — steps
	// hold objectives, objectives hold a capture target and three thresholds —
	// and a modal is already unpleasant at three of them.
	//
	// ONE DRAFT OBJECT, held here. The tab panels unmount as you move between
	// them, so anything a tab owned would be gone the moment someone clicked
	// "Report" to check a section wording and came back. `draft` lives above
	// `Tabs.Root` and the tabs mutate it in place; saving is explicit, so the
	// only thing that reaches the server is what someone pressed Save on.

	// Shell
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { useCrumbTitle } from '$lib/shell/crumb-title.svelte';
	// Access
	import { getAccessContext } from '$lib/access';
	// Primitives
	import * as Tabs from '$lib/primitives/ui/tabs';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import * as Card from '$lib/primitives/ui/card';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	// Feature
	import ObjectivesTab from '$lib/features/workflows/ObjectivesTab.svelte';
	import ReportTab from '$lib/features/workflows/ReportTab.svelte';
	import VoiceTab from '$lib/features/workflows/VoiceTab.svelte';
	import TriggerTab from '$lib/features/workflows/TriggerTab.svelte';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import {
		publishProblem,
		toDraft,
		toUpdateArgs,
		type WorkflowDraft
	} from '$lib/features/workflows/types';
	import { workflowStatusLabel, workflowStatusVariant } from '$lib/features/workflows/labels';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();
	const client = useConvexClient();

	const workflowId = $derived(page.params.id as Id<'workflows'>);
	const allowed = $derived(access.can('settings:manage'));

	const detailResponse = useQuery(api.workflows.queries.getWorkflow, () =>
		auth.isAuthenticated && allowed && workflowId ? { workflowId } : 'skip'
	);
	const detail = $derived(detailResponse.data ?? null);
	const workflow = $derived(detail?.workflow ?? null);

	useCrumbTitle(() => workflow?.name ?? null);

	/**
	 * The newest published snapshot, or null.
	 *
	 * Taken as a MAX rather than as the last row: the list arrives in whatever
	 * order the index gave it, and "published v2" next to a v3 that already
	 * exists is the one thing this header must not say.
	 */
	const currentVersion = $derived(
		detail && detail.versions.length > 0
			? Math.max(...detail.versions.map((version) => version.version))
			: null
	);

	let draft = $state<WorkflowDraft | null>(null);
	/** `toUpdateArgs` of the last thing the server accepted. The dirty baseline. */
	let savedJson = $state('');

	// Seeded ONCE. The query is live, so re-seeding on every push would mean a
	// colleague's save — or this page's own — wiping whatever is half-typed.
	let loaded = $state(false);
	$effect(() => {
		if (loaded || !workflow) return;
		const next = toDraft(workflow);
		draft = next;
		savedJson = JSON.stringify(toUpdateArgs(next));
		loaded = true;
	});

	const isDirty = $derived(draft !== null && JSON.stringify(toUpdateArgs(draft)) !== savedJson);

	/**
	 * Archived is not a recycle bin — `updateWorkflow` refuses to patch one, so
	 * every write control goes away rather than offering an edit the server will
	 * throw on. There is no un-archive yet, which is why this reads as a state
	 * and not as a toggle.
	 */
	const isReadOnly = $derived(workflow?.status === 'archived');

	const problem = $derived(draft === null ? null : publishProblem(draft));

	// The open tab lives in the URL so a workflow can be linked to a particular
	// one, and so a reload lands where the author was rather than on Objectives.
	const TAB_VALUES = ['objectives', 'report', 'voice', 'trigger'];

	const activeTab = $derived.by(() => {
		const requested = page.url.searchParams.get('tab');
		// An unknown tab falls back rather than rendering an empty panel: this
		// value arrives from a hand-editable URL and a stale bookmark.
		return requested && TAB_VALUES.includes(requested) ? requested : 'objectives';
	});

	function selectTab(value: string): void {
		if (value === activeTab) return;
		const query = value === 'objectives' ? '' : `?tab=${value}`;
		void goto(resolve(`${page.url.pathname}${query}` as Pathname), {
			// Switching a tab is not a navigation someone wants to walk back
			// through, and the page must not jump under the tab strip.
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	function reportError(error: unknown): void {
		toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
	}

	function problemMessage(value: NonNullable<typeof problem>): string {
		switch (value) {
			case 'key':
				return m.workflows_problemKey();
			case 'duplicate':
				return m.workflows_problemDuplicate();
			case 'noObjectives':
				return m.workflows_problemNoObjectives();
			case 'noSections':
				return m.workflows_problemNoSections();
			case 'reservedSection':
				return m.workflows_problemReservedSection();
		}
	}

	let isSaving = $state(false);
	let isPublishing = $state(false);
	let archiveOpen = $state(false);
	let deleteOpen = $state(false);

	// Saving is NOT gated on `problem`. The draft is editable precisely so
	// half-finished work can be put down and picked up, and every one of those
	// rules is enforced where it actually matters, on publish.
	async function save(): Promise<void> {
		if (!draft || !workflow || isSaving || isReadOnly) return;
		isSaving = true;
		const args = toUpdateArgs(draft);
		try {
			await client.mutation(api.workflows.mutations.updateWorkflow, { workflowId, ...args });
			// The baseline moves to what the server just took, not to the draft as
			// it stands now — someone typing during the round trip keeps their edit
			// AND keeps the unsaved marker that says so.
			savedJson = JSON.stringify(args);
			toast.success(m.state_saved());
		} catch (error) {
			reportError(error);
		} finally {
			isSaving = false;
		}
	}

	async function publish(): Promise<void> {
		if (!workflow || isPublishing) return;
		isPublishing = true;
		try {
			const version = await client.mutation(api.workflows.mutations.publishWorkflow, {
				workflowId
			});
			toast.success(m.workflows_publishedVersion({ version }));
		} catch (error) {
			reportError(error);
		} finally {
			isPublishing = false;
		}
	}

	/** Un-archive. No confirmation: it restores a draft, it does not run one. */
	async function restore(): Promise<void> {
		try {
			await client.mutation(api.workflows.mutations.restoreWorkflow, { workflowId });
			toast.success(m.workflows_restored());
		} catch (error) {
			reportError(error);
		}
	}
</script>

<PageContainer
	title={draft?.name || m.workflows_untitled()}
	access={allowed}
	loading={detailResponse.isLoading}
>
	{#snippet action()}
		{#if workflow}
			<div class="flex flex-wrap items-center gap-2">
				{#if isReadOnly}
					<span class="text-muted-foreground text-xs">{m.workflows_readOnly()}</span>
				{:else if isDirty}
					<span class="text-muted-foreground text-xs">{m.workflows_unsaved()}</span>
				{/if}
				{#if !isReadOnly}
					<Button
						variant="outline"
						loading={isSaving}
						disabled={isSaving || !isDirty}
						onclick={save}
					>
						{m.action_save()}
					</Button>
				{/if}
				<!--
					Publish is BLOCKED while there are unsaved edits rather than quietly
					saving first. A published version is immutable and runs name it, so
					"publish" must mean "freeze exactly what I am looking at" — a button
					that silently persisted a half-finished tab on the way would be
					freezing something nobody read back.
				-->
				{#if !isReadOnly}
					<Button
						loading={isPublishing}
						disabled={isPublishing || isDirty || problem !== null}
						onclick={publish}
					>
						{m.workflows_publishNext({ version: (currentVersion ?? 0) + 1 })}
					</Button>
				{/if}
				{#if workflow.status === 'draft'}
					<!-- Delete exists ONLY here. Nothing has ever run under a workflow
					     that was never published, so there is no replay set to protect. -->
					<Button variant="ghost" onclick={() => (deleteOpen = true)}>
						{m.action_delete()}
					</Button>
				{:else if workflow.status === 'published'}
					<Button variant="ghost" onclick={() => (archiveOpen = true)}>
						{m.workflows_archive()}
					</Button>
				{:else if workflow.status === 'archived'}
					<!-- Archive has to be reversible or it is a trap: every panel below
					     is disabled and `updateWorkflow` refuses to patch an archived
					     row, so without this the only way back would be a new workflow.
					     It returns as a DRAFT — deciding to work on something again is
					     not the same decision as deciding it should be running. -->
					<Button variant="ghost" onclick={restore}>
						{m.workflows_restore()}
					</Button>
				{/if}
			</div>
		{/if}
	{/snippet}

	{#if !workflow || !draft}
		<EmptyState title={m.workflows_notFound()} />
	{:else}
		<div class="flex flex-col gap-6">
			<Card.Root>
				<Card.Header>
					<Card.Title>{m.workflows_details()}</Card.Title>
					<Card.Action class="flex items-center gap-2">
						<Badge variant={workflowStatusVariant(workflow.status)}>
							{workflowStatusLabel(workflow.status)}
						</Badge>
						{#if currentVersion !== null}
							<Badge variant="outline">{m.workflows_version({ version: currentVersion })}</Badge>
						{/if}
					</Card.Action>
				</Card.Header>
				<Card.Content class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-2">
						<Label for="workflow-name">{m.field_name()}</Label>
						<Input
							id="workflow-name"
							bind:value={draft.name}
							disabled={isReadOnly}
							autocomplete="off"
						/>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="workflow-description">{m.field_description()}</Label>
						<Textarea
							id="workflow-description"
							bind:value={draft.description}
							disabled={isReadOnly}
							rows={2}
						/>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Why Publish is disabled, said next to the thing rather than in a
			     toast after the fact. Every one of these is refused server-side too;
			     this is the same rule, earlier. -->
			{#if problem && !isReadOnly}
				<p class="text-destructive text-sm">{problemMessage(problem)}</p>
			{/if}

			<Tabs.Root
				value={activeTab}
				onValueChange={(details: { value: string }) => selectTab(details.value)}
				class="gap-6"
			>
				<Tabs.List>
					<Tabs.Trigger value="objectives">{m.workflows_tab_objectives()}</Tabs.Trigger>
					<Tabs.Trigger value="report">{m.workflows_tab_report()}</Tabs.Trigger>
					<Tabs.Trigger value="voice">{m.workflows_tab_voice()}</Tabs.Trigger>
					<Tabs.Trigger value="trigger">{m.workflows_tab_trigger()}</Tabs.Trigger>
				</Tabs.List>

				<!--
					One `disabled` fieldset per panel rather than a read-only prop
					threaded through four components and every control inside them.
					It wraps the PANEL and not the whole tab strip on purpose: an
					archived workflow is still worth reading, and disabling the strip
					would leave a reader stuck on whichever tab the URL opened.
					`display: contents` keeps it out of the layout.
				-->
				<Tabs.Content value="objectives">
					<fieldset class="contents" disabled={isReadOnly}>
						<ObjectivesTab {draft} campaignId={workflow.campaignId} />
					</fieldset>
				</Tabs.Content>

				<Tabs.Content value="report">
					<fieldset class="contents" disabled={isReadOnly}>
						<ReportTab {draft} />
					</fieldset>
				</Tabs.Content>

				<Tabs.Content value="voice">
					<fieldset class="contents" disabled={isReadOnly}>
						<VoiceTab {draft} />
					</fieldset>
				</Tabs.Content>

				<Tabs.Content value="trigger">
					<fieldset class="contents" disabled={isReadOnly}>
						<TriggerTab {draft} campaignId={workflow.campaignId} />
					</fieldset>
				</Tabs.Content>
			</Tabs.Root>
		</div>
	{/if}
</PageContainer>

<ConfirmDialog
	bind:open={archiveOpen}
	title={m.workflows_archiveTitle()}
	body={m.workflows_archiveBody()}
	confirmLabel={m.workflows_archive()}
	onConfirm={async () => {
		await client.mutation(api.workflows.mutations.archiveWorkflow, { workflowId });
		toast.success(m.workflows_archived());
	}}
/>

<ConfirmDialog
	bind:open={deleteOpen}
	title={m.workflows_deleteTitle()}
	body={m.workflows_deleteBody()}
	onConfirm={async () => {
		await client.mutation(api.workflows.mutations.deleteWorkflow, { workflowId });
		await goto(resolve('/app/admin/workflows'));
	}}
/>
