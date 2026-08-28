<script lang="ts">
	// What a check-in asks, and what it does with the answers.
	//
	// STEPS, NOT A CANVAS. A step is a named group of objectives with an
	// optional line of guidance. There are no edges, no branches and no
	// conditions, because the engine's control structure is "which objectives
	// are still outstanding" — a graph drawn here would be a second control
	// structure competing with that one. The responder already picks its own
	// order within the outstanding set, so a step is a unit of AUTHORING rather
	// than a stage a family is marched through.
	//
	// APPEND-ONLY, no edit, no delete. A conversation freezes the template
	// version it resolved from and the decision trace is replayed against it, so
	// editing in place would re-target every log that points at it. A change is
	// a new version; promoting it is the separate decision the Activate button
	// represents.

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
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
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

	const templatesResponse = useQuery(api.checkins.templates.listTemplates, () =>
		auth.isAuthenticated ? {} : 'skip'
	);
	const templates = $derived(templatesResponse.data ?? []);

	// The org's OWN field definitions drive the capture picker. Typing a key by
	// hand would let an author point an objective at a field that does not
	// exist, and the failure would not surface until a family had already
	// answered it.
	const projectFieldsResponse = useQuery(api.customFields.queries.listFieldDefinitions, () =>
		auth.isAuthenticated ? { entity: 'project' as const } : 'skip'
	);
	const contactFieldsResponse = useQuery(api.customFields.queries.listFieldDefinitions, () =>
		auth.isAuthenticated ? { entity: 'contact' as const } : 'skip'
	);

	type CaptureKind = 'none' | 'project' | 'contact';
	type ObjectiveDraft = {
		key: string;
		label: string;
		description: string;
		captureKind: CaptureKind;
		fieldKey: string;
		skipIfKnown: boolean;
		minRating: string;
		minConfidence: string;
		maxAttempts: string;
	};
	type StepDraft = {
		key: string;
		title: string;
		entryMessage: string;
		objectives: ObjectiveDraft[];
	};

	const emptyObjective = (): ObjectiveDraft => ({
		key: '',
		label: '',
		description: '',
		captureKind: 'none',
		fieldKey: '',
		skipIfKnown: false,
		minRating: '',
		minConfidence: '',
		maxAttempts: ''
	});

	let isSeeding = $state(false);
	let activatingId = $state<string | null>(null);
	let newOpen = $state(false);
	let isSaving = $state(false);

	let version = $state('');
	let name = $state('');
	let notes = $state('');
	let activate = $state(false);
	let steps = $state<StepDraft[]>([]);

	$effect(() => {
		if (!newOpen) return;
		version = '';
		name = '';
		notes = '';
		activate = false;
		steps = [{ key: 'checkin', title: '', entryMessage: '', objectives: [emptyObjective()] }];
	});

	function fieldsFor(kind: CaptureKind) {
		if (kind === 'project') return projectFieldsResponse.data ?? [];
		if (kind === 'contact') return contactFieldsResponse.data ?? [];
		return [];
	}

	function reportError(error: unknown): void {
		toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
	}

	function addStep(): void {
		steps = [...steps, { key: '', title: '', entryMessage: '', objectives: [emptyObjective()] }];
	}
	function removeStep(index: number): void {
		steps = steps.filter((_, i) => i !== index);
	}
	function addObjective(stepIndex: number): void {
		steps[stepIndex].objectives = [...steps[stepIndex].objectives, emptyObjective()];
	}
	function removeObjective(stepIndex: number, index: number): void {
		steps[stepIndex].objectives = steps[stepIndex].objectives.filter((_, i) => i !== index);
	}

	async function seed(): Promise<void> {
		if (isSeeding) return;
		isSeeding = true;
		try {
			const inserted = await client.mutation(api.checkins.templates.seedDefaults, {});
			toast.success(
				inserted.length > 0 ? m.checkinTemplates_seeded() : m.checkinTemplates_seedNone()
			);
		} catch (error) {
			reportError(error);
		} finally {
			isSeeding = false;
		}
	}

	async function activateTemplate(templateId: Id<'checkinTemplates'>): Promise<void> {
		if (activatingId !== null) return;
		activatingId = templateId as string;
		try {
			await client.mutation(api.checkins.templates.activateTemplate, { templateId });
			toast.success(m.checkinTemplates_activated());
		} catch (error) {
			reportError(error);
		} finally {
			activatingId = null;
		}
	}

	const objectiveCount = $derived(steps.reduce((total, step) => total + step.objectives.length, 0));

	const canSubmit = $derived(
		version.trim() !== '' &&
			objectiveCount > 0 &&
			steps.every(
				(step) =>
					step.key.trim() !== '' &&
					step.objectives.every(
						(objective) =>
							objective.key.trim() !== '' &&
							objective.description.trim() !== '' &&
							// A capture with no field chosen would be saved as a write to
							// the empty key, which validateAttributes rejects later and
							// silently — so it is caught here instead.
							(objective.captureKind === 'none' || objective.fieldKey !== '')
					)
			)
	);

	/** Blank means "use the default", which is not the same number as zero. */
	const optionalNumber = (raw: string): number | undefined =>
		raw.trim() === '' ? undefined : Number(raw);

	async function handleCreate(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;
		try {
			await client.mutation(api.checkins.templates.createTemplate, {
				version: version.trim(),
				name: name.trim() || version.trim(),
				notes: notes.trim() || undefined,
				steps: steps.map((step) => ({
					key: step.key.trim(),
					title: step.title.trim() || step.key.trim(),
					entryMessage: step.entryMessage.trim() || undefined,
					objectives: step.objectives.map((objective) => ({
						key: objective.key.trim(),
						label: objective.label.trim() || objective.key.trim(),
						description: objective.description.trim(),
						minRating: optionalNumber(objective.minRating),
						minConfidence: optionalNumber(objective.minConfidence),
						maxAttempts: optionalNumber(objective.maxAttempts),
						skipIfKnown: objective.captureKind === 'none' ? undefined : objective.skipIfKnown,
						capture:
							objective.captureKind === 'none'
								? { kind: 'none' as const }
								: {
										kind: 'field' as const,
										entity: objective.captureKind,
										fieldKey: objective.fieldKey
									}
					}))
				})),
				activate
			});
			toast.success(m.checkinTemplates_created());
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
		<Card.Title>{m.checkinTemplates_title()}</Card.Title>
		<Card.Description>{m.checkinTemplates_subtitle()}</Card.Description>
		<Card.Action>
			<div class="flex gap-2">
				<Button size="sm" variant="outline" disabled={isSeeding} onclick={seed}>
					<SparklesIcon class="size-4" />
					{m.checkinTemplates_seed()}
				</Button>
				<Button size="sm" onclick={() => (newOpen = true)}>
					<PlusIcon class="size-4" />
					{m.checkinTemplates_new()}
				</Button>
			</div>
		</Card.Action>
	</Card.Header>
	<Card.Content>
		{#if templatesResponse.isLoading}
			<Skeleton class="h-24 w-full" />
		{:else if templates.length === 0}
			<EmptyState title={m.checkinTemplates_none()} description={m.checkinTemplates_noneBody()}>
				{#snippet icon()}
					<ListChecksIcon />
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
					{#each templates as template (template._id)}
						<Table.Row>
							<Table.Cell class="font-mono text-xs">{template.version}</Table.Cell>
							<Table.Cell>
								{template.name}
								<span class="text-muted-foreground ml-2 text-xs">
									{m.checkinTemplates_objectiveCount({
										count: template.steps.reduce((n, step) => n + step.objectives.length, 0)
									})}
								</span>
							</Table.Cell>
							<Table.Cell class="text-muted-foreground text-xs">
								{template.campaignId ? m.checkinTemplates_scope() : m.checkinTemplates_orgWide()}
							</Table.Cell>
							<Table.Cell class="text-right">
								{#if template.isActive}
									<Badge variant="success">{m.checkinTemplates_active()}</Badge>
								{:else}
									<Button
										size="sm"
										variant="outline"
										disabled={activatingId !== null}
										onclick={() => activateTemplate(template._id)}
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
	<Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title>{m.checkinTemplates_new()}</Dialog.Title>
		</Dialog.Header>

		<form class="flex flex-col gap-4" onsubmit={handleCreate}>
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="template-version">{m.checkinTemplates_version()}</Label>
					<Input id="template-version" bind:value={version} placeholder="template-2" />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="template-name">{m.checkinTemplates_name()}</Label>
					<Input id="template-name" bind:value={name} />
				</div>
			</div>

			{#each steps as step, stepIndex (stepIndex)}
				<div class="flex flex-col gap-3 rounded-lg border p-3">
					<div class="grid gap-3 sm:grid-cols-2">
						<div class="flex flex-col gap-1.5">
							<Label for="step-key-{stepIndex}">{m.checkinTemplates_objectiveKey()}</Label>
							<Input id="step-key-{stepIndex}" bind:value={step.key} placeholder="school" />
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="step-title-{stepIndex}">{m.checkinTemplates_stepTitle()}</Label>
							<Input id="step-title-{stepIndex}" bind:value={step.title} />
						</div>
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="step-entry-{stepIndex}">{m.checkinTemplates_entryMessage()}</Label>
						<Input id="step-entry-{stepIndex}" bind:value={step.entryMessage} />
					</div>

					{#each step.objectives as objective, index (index)}
						<div class="bg-muted/40 flex flex-col gap-3 rounded-md border p-3">
							<div class="grid gap-3 sm:grid-cols-2">
								<div class="flex flex-col gap-1.5">
									<Label for="obj-key-{stepIndex}-{index}">
										{m.checkinTemplates_objectiveKey()}
									</Label>
									<Input
										id="obj-key-{stepIndex}-{index}"
										bind:value={objective.key}
										placeholder="school_status"
									/>
								</div>
								<div class="flex flex-col gap-1.5">
									<Label for="obj-label-{stepIndex}-{index}">
										{m.checkinTemplates_objectiveLabel()}
									</Label>
									<Input id="obj-label-{stepIndex}-{index}" bind:value={objective.label} />
								</div>
							</div>

							<div class="flex flex-col gap-1.5">
								<Label for="obj-desc-{stepIndex}-{index}">
									{m.checkinTemplates_objectiveDescription()}
								</Label>
								<Textarea
									id="obj-desc-{stepIndex}-{index}"
									rows={2}
									bind:value={objective.description}
								/>
								<p class="text-muted-foreground text-xs">
									{m.checkinTemplates_objectiveDescriptionHelp()}
								</p>
							</div>

							<div class="grid gap-3 sm:grid-cols-2">
								<div class="flex flex-col gap-1.5">
									<Label for="obj-capture-{stepIndex}-{index}">
										{m.checkinTemplates_capture()}
									</Label>
									<select
										id="obj-capture-{stepIndex}-{index}"
										class="border-input bg-background h-9 rounded-md border px-3 text-sm"
										bind:value={objective.captureKind}
										onchange={() => (objective.fieldKey = '')}
									>
										<option value="none">{m.checkinTemplates_captureNone()}</option>
										<option value="project">{m.checkinTemplates_captureProject()}</option>
										<option value="contact">{m.checkinTemplates_captureContact()}</option>
									</select>
								</div>
								{#if objective.captureKind !== 'none'}
									<div class="flex flex-col gap-1.5">
										<Label for="obj-field-{stepIndex}-{index}">
											{m.checkinTemplates_captureField()}
										</Label>
										<select
											id="obj-field-{stepIndex}-{index}"
											class="border-input bg-background h-9 rounded-md border px-3 text-sm"
											bind:value={objective.fieldKey}
										>
											<option value="">—</option>
											{#each fieldsFor(objective.captureKind) as field (field._id)}
												<option value={field.key}>{field.label}</option>
											{/each}
										</select>
									</div>
								{/if}
							</div>

							{#if objective.captureKind !== 'none'}
								<label class="flex items-center gap-2 text-sm">
									<input type="checkbox" bind:checked={objective.skipIfKnown} />
									{m.checkinTemplates_skipIfKnown()}
								</label>
							{/if}

							<details>
								<summary class="text-muted-foreground cursor-pointer text-xs">
									{m.checkinTemplates_advanced()}
								</summary>
								<div class="mt-3 grid gap-3 sm:grid-cols-3">
									<div class="flex flex-col gap-1.5">
										<Label for="obj-rating-{stepIndex}-{index}">
											{m.checkinTemplates_minRating()}
										</Label>
										<Input
											id="obj-rating-{stepIndex}-{index}"
											type="number"
											step="0.05"
											min="0"
											max="1"
											bind:value={objective.minRating}
										/>
									</div>
									<div class="flex flex-col gap-1.5">
										<Label for="obj-conf-{stepIndex}-{index}">
											{m.checkinTemplates_minConfidence()}
										</Label>
										<Input
											id="obj-conf-{stepIndex}-{index}"
											type="number"
											step="0.05"
											min="0"
											max="1"
											bind:value={objective.minConfidence}
										/>
									</div>
									<div class="flex flex-col gap-1.5">
										<Label for="obj-attempts-{stepIndex}-{index}">
											{m.checkinTemplates_maxAttempts()}
										</Label>
										<Input
											id="obj-attempts-{stepIndex}-{index}"
											type="number"
											min="1"
											bind:value={objective.maxAttempts}
										/>
									</div>
								</div>
								<p class="text-muted-foreground mt-2 text-xs">
									{m.checkinTemplates_thresholdHelp()}
									{m.checkinTemplates_attemptsHelp()}
								</p>
							</details>

							{#if step.objectives.length > 1}
								<div class="flex justify-end">
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onclick={() => removeObjective(stepIndex, index)}
									>
										<Trash2Icon class="size-4" />
										{m.checkinTemplates_remove()}
									</Button>
								</div>
							{/if}
						</div>
					{/each}

					<div class="flex justify-between">
						<Button
							type="button"
							size="sm"
							variant="outline"
							onclick={() => addObjective(stepIndex)}
						>
							<PlusIcon class="size-4" />
							{m.checkinTemplates_addObjective()}
						</Button>
						{#if steps.length > 1}
							<Button type="button" size="sm" variant="ghost" onclick={() => removeStep(stepIndex)}>
								<Trash2Icon class="size-4" />
								{m.checkinTemplates_remove()}
							</Button>
						{/if}
					</div>
				</div>
			{/each}

			<Button type="button" size="sm" variant="outline" onclick={addStep}>
				<PlusIcon class="size-4" />
				{m.checkinTemplates_addStep()}
			</Button>

			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={activate} />
				{m.checkinTemplates_activateOnSave()}
			</label>

			<Dialog.Footer>
				<Button type="submit" disabled={!canSubmit || isSaving}>{m.action_save()}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
