<script lang="ts">
	// The shape a drafted update comes back in.
	//
	// APPEND-ONLY like the prompts next to it, and for a related but distinct
	// reason. A conversation freezes the format version it will be drafted
	// against, so editing one in place would change the tool a conversation was
	// promised halfway through answering. There is no edit and no delete here.
	//
	// WHAT A SECTION ACTUALLY IS. Each row below becomes a required property on
	// the `draft_update` tool the model must call. That is why this screen is
	// worth its weight: a section added here is a section the draft WILL have,
	// enforced by the shape of the function call rather than requested in a
	// paragraph the model may skim.

	import * as Card from '$lib/primitives/ui/card';
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import LayoutTemplateIcon from '@lucide/svelte/icons/layout-template';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	const formatsResponse = useQuery(api.checkins.templates.listUpdateFormats, () =>
		auth.isAuthenticated ? {} : 'skip'
	);
	const formats = $derived(formatsResponse.data ?? []);

	let activatingId = $state<string | null>(null);
	let newOpen = $state(false);
	let isSaving = $state(false);

	type SectionDraft = { key: string; label: string; guidance: string; approxWords: string };

	let version = $state('');
	let name = $state('');
	let titleGuidance = $state('');
	let instructions = $state('');
	let activate = $state(false);
	let sections = $state<SectionDraft[]>([]);

	$effect(() => {
		if (!newOpen) return;
		version = '';
		name = '';
		titleGuidance = 'At most eight words.';
		instructions = '';
		activate = false;
		sections = [
			{ key: 'body', label: 'Update', guidance: 'Two or three short paragraphs.', approxWords: '' }
		];
	});

	function reportError(error: unknown): void {
		toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
	}

	function addSection(): void {
		sections = [...sections, { key: '', label: '', guidance: '', approxWords: '' }];
	}

	function removeSection(index: number): void {
		sections = sections.filter((_, i) => i !== index);
	}

	async function activateFormat(formatId: Id<'updateFormats'>): Promise<void> {
		if (activatingId !== null) return;
		activatingId = formatId as string;
		try {
			await client.mutation(api.checkins.templates.activateUpdateFormat, { formatId });
			toast.success(m.checkinFormats_activated());
		} catch (error) {
			reportError(error);
		} finally {
			activatingId = null;
		}
	}

	const canSubmit = $derived(
		version.trim() !== '' &&
			titleGuidance.trim() !== '' &&
			sections.length > 0 &&
			sections.every((section) => section.key.trim() !== '' && section.guidance.trim() !== '')
	);

	async function handleCreate(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;
		try {
			await client.mutation(api.checkins.templates.createUpdateFormat, {
				version: version.trim(),
				name: name.trim() || version.trim(),
				titleGuidance: titleGuidance.trim(),
				instructions: instructions.trim(),
				sections: sections.map((section) => ({
					key: section.key.trim(),
					label: section.label.trim() || section.key.trim(),
					guidance: section.guidance.trim(),
					// Blank is "no steer", which is a different instruction from
					// "around 0 words" — so it must not become a number.
					approxWords: section.approxWords.trim() ? Number(section.approxWords) : undefined
				})),
				activate
			});
			toast.success(m.checkinFormats_created());
			newOpen = false;
		} catch (error) {
			reportError(error);
		} finally {
			isSaving = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.checkinFormats_title()}</Card.Title>
		<Card.Description>{m.checkinFormats_subtitle()}</Card.Description>
		<Card.Action>
			<Button size="sm" onclick={() => (newOpen = true)}>
				<PlusIcon class="size-4" />
				{m.checkinFormats_new()}
			</Button>
		</Card.Action>
	</Card.Header>
	<Card.Content>
		{#if formatsResponse.isLoading}
			<Skeleton class="h-24 w-full" />
		{:else if formats.length === 0}
			<EmptyState title={m.checkinFormats_none()} description={m.checkinFormats_noneBody()}>
				{#snippet icon()}
					<LayoutTemplateIcon />
				{/snippet}
			</EmptyState>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>{m.checkinTemplates_version()}</Table.Head>
						<Table.Head>{m.checkinTemplates_name()}</Table.Head>
						<Table.Head>{m.checkinTemplates_scope()}</Table.Head>
						<Table.Head></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each formats as format (format._id)}
						<Table.Row>
							<Table.Cell class="font-mono text-xs">{format.version}</Table.Cell>
							<Table.Cell>
								{format.name}
								<span class="text-muted-foreground ml-2 text-xs">
									{m.checkinFormats_sections({ count: format.sections.length })}
								</span>
							</Table.Cell>
							<Table.Cell class="text-muted-foreground text-xs">
								{format.campaignId ? m.checkinTemplates_scope() : m.checkinTemplates_orgWide()}
							</Table.Cell>
							<Table.Cell class="text-right">
								{#if format.isActive}
									<Badge variant="success">{m.checkinTemplates_active()}</Badge>
								{:else}
									<Button
										size="sm"
										variant="outline"
										disabled={activatingId !== null}
										onclick={() => activateFormat(format._id)}
									>
										{m.checkinTemplates_activate()}
									</Button>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</Card.Content>
</Card.Root>

<Dialog.Root bind:open={newOpen}>
	<Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{m.checkinFormats_new()}</Dialog.Title>
			<Dialog.Description>{m.checkinFormats_oneSectionNote()}</Dialog.Description>
		</Dialog.Header>

		<form class="flex flex-col gap-4" onsubmit={handleCreate}>
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="format-version">{m.checkinTemplates_version()}</Label>
					<Input id="format-version" bind:value={version} placeholder="format-2" />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="format-name">{m.checkinTemplates_name()}</Label>
					<Input id="format-name" bind:value={name} />
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="format-title">{m.checkinFormats_titleGuidance()}</Label>
				<Input id="format-title" bind:value={titleGuidance} />
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="format-instructions">{m.checkinFormats_instructions()}</Label>
				<Textarea id="format-instructions" rows={3} bind:value={instructions} />
				<p class="text-muted-foreground text-xs">{m.checkinFormats_instructionsHelp()}</p>
			</div>

			<div class="flex flex-col gap-3">
				{#each sections as section, index (index)}
					<div class="flex flex-col gap-3 rounded-lg border p-3">
						<div class="grid gap-3 sm:grid-cols-3">
							<div class="flex flex-col gap-1.5">
								<Label for="section-key-{index}">{m.checkinFormats_sectionKey()}</Label>
								<Input id="section-key-{index}" bind:value={section.key} placeholder="whats_new" />
							</div>
							<div class="flex flex-col gap-1.5">
								<Label for="section-label-{index}">{m.checkinFormats_sectionLabel()}</Label>
								<Input id="section-label-{index}" bind:value={section.label} />
							</div>
							<div class="flex flex-col gap-1.5">
								<Label for="section-words-{index}">{m.checkinFormats_approxWords()}</Label>
								<Input
									id="section-words-{index}"
									type="number"
									min="10"
									bind:value={section.approxWords}
								/>
							</div>
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="section-guidance-{index}">{m.checkinFormats_sectionGuidance()}</Label>
							<Textarea id="section-guidance-{index}" rows={2} bind:value={section.guidance} />
						</div>
						{#if sections.length > 1}
							<div class="flex justify-end">
								<Button
									type="button"
									size="sm"
									variant="ghost"
									onclick={() => removeSection(index)}
								>
									<Trash2Icon class="size-4" />
									{m.checkinTemplates_remove()}
								</Button>
							</div>
						{/if}
					</div>
				{/each}
				<Button type="button" size="sm" variant="outline" onclick={addSection}>
					<PlusIcon class="size-4" />
					{m.checkinFormats_addSection()}
				</Button>
			</div>

			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={activate} />
				{m.checkinTemplates_activateOnSave()}
			</label>

			<Dialog.Footer>
				<Button type="submit" disabled={!canSubmit || isSaving}>
					{m.action_save()}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
