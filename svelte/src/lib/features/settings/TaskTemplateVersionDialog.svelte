<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Alert from '$lib/primitives/ui/alert';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Switch } from '$lib/primitives/ui/switch';
	import type { SwitchCheckedChangeDetails } from '$lib/primitives/ui/switch';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import InfoIcon from '@lucide/svelte/icons/info';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import type { TaskTemplate, TaskTemplateScope } from './types';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const client = useConvexClient();

	let {
		open = $bindable(false),
		campaignId,
		template = null,
		scope = 'project'
	}: {
		open?: boolean;
		campaignId: Id<'campaigns'>;
		/** Null creates a new version; a template edits that one in place. */
		template?: TaskTemplate | null;
		/**
		 * Which checklist this version belongs to. A campaign keeps one active
		 * version of EACH, and they are different lists of different work — see
		 * PLAN-trips.md §6.
		 */
		scope?: TaskTemplateScope;
	} = $props();

	const isEdit = $derived(template !== null);
	const isTrip = $derived(scope === 'trip');

	// `existingKey` is set for a row that was already saved. Its key is then
	// immutable — the key is how a project's tasks are matched back to the
	// template, so renaming one would orphan every task carrying it.
	type Row = {
		id: number;
		key: string;
		label: string;
		impactTag: string;
		/**
		 * Trip scope only: answered once PER TRAVELLER rather than once per trip.
		 * "Book group lodging" is one tick; "passport valid 6 months past return"
		 * is one per person, and a single shared tick would hide the one traveller
		 * who cannot board.
		 */
		perAttendee: boolean;
		existingKey: string | null;
	};

	// Where each tag's stat shows. Keyed by TAG, not by row, because the tag is
	// the stat: two items carrying `business` are one number, counted over
	// distinct records, so they cannot disagree about where it appears.
	type Surfaces = { showOnPublic: boolean; showOnDashboard: boolean };

	let nextRowId = 0;
	let version = $state('');
	let effectiveFrom = $state('');
	let activate = $state(false);
	let rows = $state<Row[]>([]);
	let surfaces = $state<Record<string, Surfaces>>({});
	let isSaving = $state(false);

	// How many records already hold a task for each key, so removing an item is
	// an informed choice rather than a silent one.
	const countsResponse = useQuery(api.taskTemplates.queries.countTasksByKey, () =>
		open ? { campaignId } : 'skip'
	);
	const taskCounts = $derived(countsResponse.data ?? {});

	// Where each existing tag's stat shows today. The dialog seeds from this so
	// a tag already publishing keeps its toggles on when the checklist is edited.
	const tagsResponse = useQuery(api.taskTemplates.queries.listImpactTags, () =>
		open ? { campaignId } : 'skip'
	);
	const savedSurfaces = $derived(tagsResponse.data ?? []);

	function blankRow(): Row {
		nextRowId += 1;
		return { id: nextRowId, key: '', label: '', impactTag: '', perAttendee: false, existingKey: null };
	}

	/** The stat settings for a tag, defaulting to "tracked but shown nowhere". */
	function surfacesFor(tag: string): Surfaces {
		return surfaces[tag] ?? { showOnPublic: false, showOnDashboard: false };
	}

	function setSurface(tag: string, key: keyof Surfaces, value: boolean): void {
		const trimmed = tag.trim();
		if (!trimmed) return;
		surfaces = { ...surfaces, [trimmed]: { ...surfacesFor(trimmed), [key]: value } };
	}

	$effect(() => {
		if (!open) return;
		const source = template;
		version = source?.version ?? '';
		effectiveFrom = source?.effectiveFrom ?? '';
		activate = false;
		rows = source
			? [...source.items]
					.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
					.map((item) => {
						nextRowId += 1;
						return {
							id: nextRowId,
							key: item.key,
							label: item.label,
							impactTag: item.impactTag ?? '',
							perAttendee: item.perAttendee ?? false,
							existingKey: item.key
						};
					})
			: [blankRow()];
	});

	// Seeded separately from the rows: the tag list arrives on its own query, and
	// re-seeding on every keystroke would fight the toggles being flipped.
	let surfacesLoaded = $state(false);
	$effect(() => {
		if (!open) {
			surfacesLoaded = false;
			return;
		}
		if (surfacesLoaded || tagsResponse.isLoading) return;
		const next: Record<string, Surfaces> = {};
		for (const entry of savedSurfaces) {
			next[entry.tag] = {
				showOnPublic: entry.showOnPublic,
				showOnDashboard: entry.showOnDashboard
			};
		}
		surfaces = next;
		surfacesLoaded = true;
	});

	const filled = $derived(rows.filter((row) => row.key.trim() !== '' || row.label.trim() !== ''));

	const rowsComplete = $derived(
		filled.every((row) => row.key.trim() !== '' && row.label.trim() !== '')
	);

	const duplicateKeys = $derived.by(() => {
		const keys = filled.map((row) => row.key.trim()).filter((key) => key !== '');
		return keys.filter((key, index) => keys.indexOf(key) !== index);
	});

	const canSubmit = $derived(
		version.trim().length > 0 && filled.length > 0 && rowsComplete && duplicateKeys.length === 0
	);

	/** Every distinct tag in the form, in row order. One tag is one stat. */
	const tagsInUse = $derived([
		...new Set(filled.map((row) => row.impactTag.trim()).filter((tag) => tag !== ''))
	]);

	// Publishing is only meaningful for a tag, so the warning fires on the stat
	// rather than on any one row.
	const publishesACount = $derived(tagsInUse.some((tag) => surfacesFor(tag).showOnPublic));

	/**
	 * Saved items that this edit would drop, and how many records already hold a
	 * task for each. Those tasks are left alone — they are work that actually
	 * happened — so the dialog says so rather than implying a clean removal.
	 */
	const removedWithTasks = $derived.by(() => {
		if (!template) return [];
		const kept = new Set(rows.map((row) => row.existingKey).filter(Boolean));
		return template.items
			.filter((item) => !kept.has(item.key))
			.map((item) => ({ label: item.label, count: taskCounts[item.key] ?? 0 }))
			.filter((entry) => entry.count > 0);
	});

	function addRow(): void {
		rows = [...rows, blankRow()];
	}

	function removeRow(id: number): void {
		rows = rows.filter((row) => row.id !== id);
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

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;

		// The two scope-only fields are sent as UNSET rather than false/empty on the
		// scope that cannot hold them. The write path refuses `impactTag` on a trip
		// item and `perAttendee` on a project one, and sending an explicit `false`
		// for a field the row is not allowed to carry is how a harmless default
		// turns into a rejected save.
		const items = filled.map((row, index) => ({
			key: row.key.trim(),
			label: row.label.trim(),
			order: index,
			impactTag: isTrip ? undefined : row.impactTag.trim() || undefined,
			perAttendee: isTrip && row.perAttendee ? true : undefined
		}));

		// One save: the items and where each tag's number shows go together, and a
		// Convex mutation is a transaction, so they cannot half-apply.
		const statSurfaces = tagsInUse.map((tag) => ({ impactTag: tag, ...surfacesFor(tag) }));

		isSaving = true;
		try {
			if (template) {
				await client.mutation(api.taskTemplates.mutations.updateTaskTemplate, {
					taskTemplateId: template._id,
					items,
					statSurfaces,
					effectiveFrom: effectiveFrom.trim() || undefined
				});
				toast.success(m.settings_taskUpdated());
			} else {
				await client.mutation(api.taskTemplates.mutations.createTaskTemplateVersion, {
					campaignId,
					version: version.trim(),
					items,
					statSurfaces,
					effectiveFrom: effectiveFrom.trim() || undefined,
					activate,
					scope
				});
				toast.success(m.settings_taskCreated());
			}
			open = false;
		} catch (error: unknown) {
			reportError(error);
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-3xl">
		<Dialog.Header class="w-full">
			<Dialog.Title>
				{isEdit ? m.settings_taskVersionEdit({ version: version || '' }) : m.settings_versionNew()}
			</Dialog.Title>
		</Dialog.Header>

		<Alert.Root class="w-full">
			<InfoIcon class="size-4" />
			<Alert.Description>
				{isEdit ? m.settings_taskEditNote() : m.settings_taskAppendOnlyNote()}
			</Alert.Description>
		</Alert.Root>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="task-version">{m.settings_version()}</Label>
					<!-- The version names the row; renaming it would make an old task's
					     recorded templateVersion point at nothing. -->
					<Input
						id="task-version"
						bind:value={version}
						placeholder="2026.1"
						required
						readonly={isEdit}
						disabled={isEdit}
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="task-effective-from">{m.settings_effectiveFrom()}</Label>
					<Input id="task-effective-from" type="date" bind:value={effectiveFrom} />
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<Label>{m.nav_tasks()}</Label>
				<p class="text-muted-foreground text-xs">
					{isTrip ? m.settings_perAttendeeHelp() : m.settings_impactTagHelp()}
				</p>

				<div
					class="text-muted-foreground flex items-center gap-2 text-[11px] font-medium tracking-wide uppercase"
				>
					<span class="w-40 shrink-0">{m.settings_taskItemKey()}</span>
					<span class="flex-1">{m.settings_taskItemLabel()}</span>
					{#if isTrip}
						<span class="w-28 shrink-0 text-center">{m.settings_perAttendeeShort()}</span>
					{:else}
						<span class="w-36 shrink-0">{m.settings_impactTag()}</span>
						<span class="w-9 shrink-0 text-center">{m.campaignStats_onPublicShort()}</span>
						<span class="w-9 shrink-0 text-center">{m.campaignStats_onDashboardShort()}</span>
					{/if}
					<span class="w-9 shrink-0"></span>
				</div>

				<div class="flex flex-col gap-2">
					{#each rows as row (row.id)}
						<!--
							The surface toggles belong to the TAG, not the row: two items
							carrying `business` are one number, so flipping either flips
							both. An untagged row has no stat to place, so both are disabled.
						-->
						{@const tag = row.impactTag.trim()}
						<div class="flex items-center gap-2">
							<Input
								bind:value={row.key}
								class="w-40 shrink-0 font-mono"
								placeholder={m.settings_taskItemKey()}
								aria-label={m.settings_taskItemKey()}
								aria-invalid={duplicateKeys.includes(row.key.trim()) || undefined}
								readonly={row.existingKey !== null}
								disabled={row.existingKey !== null}
								title={row.existingKey !== null ? m.settings_taskItemKeyLocked() : undefined}
							/>
							<Input
								bind:value={row.label}
								placeholder={m.settings_taskItemLabel()}
								aria-label={m.settings_taskItemLabel()}
							/>
							{#if isTrip}
								<!--
									One tick per traveller instead of one for the trip. A trip
									item carries no impact tag at all — a tagged task counts
									DISTINCT records and a trip names none, so the write path
									refuses it rather than letting it count zero forever.
								-->
								<div class="flex w-28 shrink-0 justify-center">
									<Switch
										checked={row.perAttendee}
										aria-label={m.settings_perAttendee()}
										title={m.settings_perAttendeeHelp()}
										onCheckedChange={(details: SwitchCheckedChangeDetails): void => {
											row.perAttendee = details.checked;
										}}
									/>
								</div>
							{:else}
								<Input
									bind:value={row.impactTag}
									class="w-36 shrink-0"
									placeholder={m.settings_impactTag()}
									aria-label={m.settings_impactTag()}
								/>
								<Switch
									checked={surfacesFor(tag).showOnPublic}
									disabled={tag === ''}
									aria-label={m.campaignStats_onPublic()}
									title={m.campaignStats_onPublic()}
									onCheckedChange={(details: SwitchCheckedChangeDetails): void => {
										setSurface(tag, 'showOnPublic', details.checked);
									}}
								/>
								<Switch
									checked={surfacesFor(tag).showOnDashboard}
									disabled={tag === ''}
									aria-label={m.campaignStats_onDashboard()}
									title={m.campaignStats_onDashboard()}
									onCheckedChange={(details: SwitchCheckedChangeDetails): void => {
										setSurface(tag, 'showOnDashboard', details.checked);
									}}
								/>
							{/if}
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label={m.settings_taskItemRemove()}
								title={m.settings_taskItemRemove()}
								disabled={rows.length === 1}
								onclick={() => removeRow(row.id)}
							>
								<Trash2Icon />
							</Button>
						</div>
					{/each}
				</div>

				<div>
					<Button type="button" variant="outline" size="sm" onclick={addRow}>
						<PlusIcon />
						{m.settings_taskItemAdd()}
					</Button>
				</div>

				{#if duplicateKeys.length > 0}
					<p class="text-error-700-300 text-xs">{m.settings_taskItemKeyDuplicate()}</p>
				{/if}
			</div>

			{#if removedWithTasks.length > 0}
				<Alert.Root variant="warning" class="w-full">
					<InfoIcon class="size-4" />
					<Alert.Description>
						{m.settings_taskItemRemovedKeepsTasks({
							items: removedWithTasks.map((entry) => `${entry.label} (${entry.count})`).join(', ')
						})}
					</Alert.Description>
				</Alert.Root>
			{/if}

			{#if publishesACount}
				<!-- Same warning an admin meets on a public custom field, so
				     "published" looks the same wherever they run into it. -->
				<Alert.Root variant="warning" class="w-full">
					<EyeIcon class="size-4" />
					<Alert.Description>{m.settings_taskPublicWarning()}</Alert.Description>
				</Alert.Root>
			{/if}

			{#if !isEdit}
				<Switch bind:checked={activate}>{m.settings_activateOnCreate()}</Switch>
			{/if}

			<Dialog.Footer class="w-full">
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || !canSubmit}>
					{isEdit ? m.action_saveChanges() : m.action_create()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
