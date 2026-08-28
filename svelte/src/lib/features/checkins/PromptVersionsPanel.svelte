<script lang="ts">
	// The words a machine says on the charity's behalf, and which set of them is
	// live right now.
	//
	// APPEND-ONLY, and there is no edit and no delete control anywhere in this
	// file on purpose. Every logged conversation records the prompt version that
	// produced it, and the log is also the replay set — editing a version in place
	// would silently rewrite the question that every past conversation was
	// answering, and a replay against a moved goalpost proves nothing. A wording
	// change is a NEW version; promoting it is a separate, later decision, which
	// is why `createPromptVersion` inserts inactive and the only write on a
	// row here is "make active".

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { createListCollection } from '@ark-ui/svelte/select';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';
	import { PROMPT_ROLES, promptRoleLabel } from './labels';
	import type { PromptRole } from './types';

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	/** What the shipped set is seeded against when nothing is active yet. */
	const FALLBACK_MODEL = 'claude-opus-5';

	const versionsResponse = useQuery(api.checkins.queries.listPromptVersions, () =>
		auth.isAuthenticated ? {} : 'skip'
	);
	const versions = $derived(versionsResponse.data ?? []);

	const settingsResponse = useQuery(api.checkins.queries.checkinSettings, () =>
		auth.isAuthenticated ? {} : 'skip'
	);
	const settings = $derived(settingsResponse.data ?? null);

	// Seed against whatever the live responder was written for, so a second seed
	// on a deployment that has already moved tier does not quietly reintroduce
	// the old one. Only when there is no active responder at all does the
	// shipped default apply.
	const seedModel = $derived(
		versions.find((version) => version.role === 'responder' && version.isActive)?.model ??
			FALLBACK_MODEL
	);

	let isSeeding = $state(false);
	let activatingId = $state<string | null>(null);

	let newOpen = $state(false);
	let role = $state<PromptRole>('responder');
	let version = $state('');
	let model = $state('');
	let notes = $state('');
	let content = $state('');
	let isSaving = $state(false);

	const roleCollection = createListCollection({
		items: PROMPT_ROLES.map((value) => ({ value, label: promptRoleLabel(value) }))
	});

	$effect(() => {
		if (!newOpen) return;
		role = 'responder';
		version = '';
		// Prefilled, not fixed: the model this wording was tuned for is the single
		// most commonly forgotten field, and the live one is the right first guess.
		model = seedModel;
		notes = '';
		content = '';
	});

	function reportError(error: unknown): void {
		toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
	}

	async function seed(): Promise<void> {
		if (isSeeding) return;
		isSeeding = true;
		try {
			const inserted = await client.mutation(api.checkins.mutations.seedPromptVersions, {
				model: seedModel
			});
			// Seeding is idempotent, so "0 added" is a normal outcome and not a
			// failure — it gets its own sentence rather than a "0 prompt versions
			// added" that reads like something went wrong.
			toast.success(
				inserted > 0 ? m.checkinPrompts_seeded({ count: inserted }) : m.checkinPrompts_seedNone()
			);
		} catch (error) {
			reportError(error);
		} finally {
			isSeeding = false;
		}
	}

	async function activate(promptVersionId: Id<'promptVersions'>): Promise<void> {
		if (activatingId !== null) return;
		activatingId = promptVersionId as string;
		try {
			await client.mutation(api.checkins.mutations.activatePromptVersion, { promptVersionId });
			toast.success(m.checkinPrompts_activated());
		} catch (error) {
			reportError(error);
		} finally {
			activatingId = null;
		}
	}

	const canSubmit = $derived(version.trim() !== '' && model.trim() !== '' && content.trim() !== '');

	async function handleCreate(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;
		try {
			await client.mutation(api.checkins.mutations.createPromptVersion, {
				role,
				version: version.trim(),
				content,
				model: model.trim(),
				notes: notes.trim() || undefined
			});
			toast.success(m.checkinPrompts_created());
			newOpen = false;
		} catch (error) {
			reportError(error);
		} finally {
			isSaving = false;
		}
	}
</script>

<div class="flex flex-col gap-4">
	<!--
		What this deployment can actually do right now. Without the key nothing
		runs at all, so it leads — a table full of prompts on a deployment with no
		key is a list of things that will never be said.
	-->
	<Card.Root>
		<Card.Header>
			<Card.Title>{m.checkinPrompts_apiKey()}</Card.Title>
			{#if settings && !settings.apiKeyConfigured}
				<Card.Description>{m.checkins_notConfiguredBody()}</Card.Description>
			{/if}
			<Card.Action>
				{#if settingsResponse.isLoading}
					<Skeleton class="h-5 w-24" />
				{:else}
					<Badge variant={settings?.apiKeyConfigured ? 'success' : 'destructive'}>
						{settings?.apiKeyConfigured
							? m.checkinPrompts_apiKeySet()
							: m.checkinPrompts_apiKeyMissing()}
					</Badge>
				{/if}
			</Card.Action>
		</Card.Header>
		<Card.Content>
			<dl class="grid gap-3 sm:grid-cols-3">
				{#each [{ label: promptRoleLabel('responder'), value: settings?.activeResponder }, { label: promptRoleLabel('drafter'), value: settings?.activeDrafter }, { label: promptRoleLabel('judge'), value: settings?.activeJudge }] as active (active.label)}
					<div class="flex flex-col gap-1">
						<dt class="text-muted-foreground text-xs">{active.label}</dt>
						<dd class="font-mono text-xs">
							{#if active.value}
								{active.value}
							{:else}
								<span class="text-muted-foreground">{m.checkinPrompts_apiKeyMissing()}</span>
							{/if}
						</dd>
					</div>
				{/each}
			</dl>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>{m.checkinPrompts_title()}</Card.Title>
			<Card.Description>{m.checkinPrompts_subtitle()}</Card.Description>
			<Card.Action class="flex flex-wrap items-center gap-2">
				<Button variant="outline" size="sm" loading={isSeeding} onclick={seed}>
					<SparklesIcon class="size-4" aria-hidden="true" />
					{m.checkinPrompts_seed()}
				</Button>
				<Button size="sm" onclick={() => (newOpen = true)}>
					<PlusIcon class="size-4" aria-hidden="true" />
					{m.checkinPrompts_new()}
				</Button>
			</Card.Action>
		</Card.Header>
		<Card.Content>
			{#if versionsResponse.isLoading}
				<div class="flex flex-col gap-3">
					<Skeleton class="h-8 w-full" />
					<Skeleton class="h-8 w-full" />
					<Skeleton class="h-8 w-full" />
				</div>
			{:else if versions.length === 0}
				<EmptyState title={m.checkinPrompts_empty()} description={m.checkinPrompts_emptyBody()}>
					{#snippet icon()}
						<FileTextIcon />
					{/snippet}
					{#snippet action()}
						<Button variant="outline" loading={isSeeding} onclick={seed}>
							<SparklesIcon class="size-4" aria-hidden="true" />
							{m.checkinPrompts_seed()}
						</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<Table.Root>
					<Table.Header class="bg-muted">
						<Table.Row>
							<Table.Head>{m.checkinPrompts_role()}</Table.Head>
							<Table.Head>{m.checkinPrompts_version()}</Table.Head>
							<Table.Head>{m.checkinPrompts_model()}</Table.Head>
							<Table.Head>{m.checkinPrompts_active()}</Table.Head>
							<Table.Head>{m.checkinPrompts_notes()}</Table.Head>
							<Table.Head class="w-32 text-right">{m.field_actions()}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each versions as promptVersion (promptVersion._id)}
							<Table.Row>
								<Table.Cell>{promptRoleLabel(promptVersion.role)}</Table.Cell>
								<Table.Cell class="font-mono text-xs">{promptVersion.version}</Table.Cell>
								<Table.Cell class="text-muted-foreground font-mono text-xs">
									{promptVersion.model}
								</Table.Cell>
								<Table.Cell>
									{#if promptVersion.isActive}
										<Badge variant="success">{m.checkinPrompts_active()}</Badge>
									{:else}
										<span class="text-muted-foreground" aria-hidden="true">—</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-muted-foreground text-xs">
									{promptVersion.notes ?? '—'}
								</Table.Cell>
								<!--
									One action, and only one. There is no edit and no delete here
									by design — see the note at the top of this file.
								-->
								<Table.Cell class="text-right">
									{#if !promptVersion.isActive}
										<Button
											variant="outline"
											size="sm"
											loading={activatingId === (promptVersion._id as string)}
											disabled={activatingId !== null}
											onclick={() => activate(promptVersion._id)}
										>
											{m.checkinPrompts_activate()}
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
</div>

<Dialog.Root bind:open={newOpen}>
	<Dialog.Content class="md:max-w-2xl">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.checkinPrompts_newTitle()}</Dialog.Title>
			<!-- Says it is inserted INACTIVE. This is the sentence that stops a new
			     wording reaching a family before anyone replays it. -->
			<Dialog.Description>{m.checkinPrompts_newBody()}</Dialog.Description>
		</Dialog.Header>

		<form class="flex w-full flex-col gap-4" onsubmit={handleCreate}>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="new-prompt-role">{m.checkinPrompts_role()}</Label>
					<Select.Root
						collection={roleCollection}
						value={[role]}
						onValueChange={(details: { value: string[] }): void => {
							const next = details.value[0];
							if (next) role = next as PromptRole;
						}}
					>
						<Select.Trigger
							id="new-prompt-role"
							class="w-full"
							placeholder={m.checkinPrompts_role()}
						/>
						<Select.Content>
							{#each roleCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="new-prompt-version">{m.checkinPrompts_version()}</Label>
					<Input id="new-prompt-version" bind:value={version} required autocomplete="off" />
					<p class="text-muted-foreground text-xs">{m.checkinPrompts_versionHelp()}</p>
				</div>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="new-prompt-model">{m.checkinPrompts_model()}</Label>
					<Input id="new-prompt-model" bind:value={model} required autocomplete="off" />
					<p class="text-muted-foreground text-xs">{m.checkinPrompts_modelHelp()}</p>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="new-prompt-notes">{m.checkinPrompts_notes()}</Label>
					<Input id="new-prompt-notes" bind:value={notes} autocomplete="off" />
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<Label for="new-prompt-content">{m.checkinPrompts_content()}</Label>
				<!-- Monospaced and tall: this is the literal text a model receives,
				     and its whitespace is load-bearing. -->
				<Textarea
					id="new-prompt-content"
					bind:value={content}
					rows={12}
					class="font-mono text-xs"
					required
				/>
			</div>

			<Dialog.Footer class="w-full">
				<Button
					type="button"
					variant="outline"
					onclick={() => (newOpen = false)}
					disabled={isSaving}
				>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || !canSubmit}>
					{m.action_create()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
