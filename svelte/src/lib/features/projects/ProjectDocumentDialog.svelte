<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import type { PipelineStage } from '$lib/domain/stages';
	import { dollarsToCents } from '$lib/features/settings/amount';
	import * as m from '$lib/i18n/messages';
	import { DOCUMENT_KINDS, documentKindLabel } from './labels';
	import type { DocumentKind } from './labels';

	let {
		open = $bindable(false),
		projectId,
		stages,
		defaultStage
	}: {
		open?: boolean;
		projectId: Id<'projects'>;
		stages: PipelineStage[];
		defaultStage: string;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	type Source = 'url' | 'file';

	let kind = $state<DocumentKind>('receipt');
	let stage = $state('');
	let source = $state<Source>('url');
	let url = $state('');
	let files = $state<FileList | null>(null);
	let notes = $state('');
	let company = $state('');
	let amount = $state('');
	let occurredOn = $state('');
	let isSaving = $state(false);

	const kindCollection = createListCollection({
		items: DOCUMENT_KINDS.map((value) => ({ value, label: documentKindLabel(value) }))
	});

	const stageCollection = $derived(
		createListCollection({
			items: stages.map((item) => ({ value: item.key, label: item.label }))
		})
	);

	const sourceCollection = createListCollection({
		items: [
			{ value: 'url', label: m.projects_documentUrl() },
			{ value: 'file', label: m.projects_documentFile() }
		]
	});

	$effect(() => {
		if (!open) return;
		kind = 'receipt';
		stage = defaultStage;
		source = 'url';
		url = '';
		files = null;
		notes = '';
		company = '';
		amount = '';
		occurredOn = '';
	});

	const amountCents = $derived(amount.trim() === '' ? null : dollarsToCents(amount));
	const amountValid = $derived(amount.trim() === '' || (amountCents !== null && amountCents >= 0));

	const selectedFile = $derived(files?.item(0) ?? null);

	const hasAttachment = $derived(source === 'url' ? url.trim() !== '' : selectedFile !== null);

	const canSubmit = $derived(stage !== '' && amountValid && hasAttachment);

	/**
	 * Convex storage is a two-step upload: the mutation hands back a short-lived
	 * signed URL, the browser POSTs the bytes straight to it, and only the
	 * returned storageId is written to the row.
	 */
	async function uploadFile(file: File): Promise<Id<'_storage'>> {
		const uploadUrl = await client.mutation(api.documents.mutations.generateUploadUrl, {});
		const response = await fetch(uploadUrl, {
			method: 'POST',
			headers: { 'Content-Type': file.type },
			body: file
		});
		if (!response.ok) {
			throw new Error(m.state_saveFailed());
		}
		const body = (await response.json()) as { storageId: Id<'_storage'> };
		return body.storageId;
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;

		try {
			const file = source === 'file' ? selectedFile : null;
			const storageId = file ? await uploadFile(file) : undefined;

			await client.mutation(api.documents.mutations.createDocument, {
				projectId,
				stage,
				kind,
				url: source === 'url' ? url.trim() : undefined,
				storageId,
				notes: notes.trim() || undefined,
				company: company.trim() || undefined,
				amountCents: amountCents ?? undefined,
				occurredOn: occurredOn.trim() || undefined
			});
			toast.success(m.projects_documentSaved());
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
	<Dialog.Content class="md:max-w-2xl">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.projects_addDocument()}</Dialog.Title>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label>{m.projects_documentKind()}</Label>
					<Select.Root
						collection={kindCollection}
						value={[kind]}
						onValueChange={(details: { value: string[] }): void => {
							const next = details.value[0];
							if (next) kind = next as DocumentKind;
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.projects_documentKind()} />
						<Select.Content>
							{#each kindCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="flex flex-col gap-2">
					<Label>{m.projects_documentStage()}</Label>
					<Select.Root
						collection={stageCollection}
						value={stage === '' ? [] : [stage]}
						onValueChange={(details: { value: string[] }): void => {
							stage = details.value[0] ?? '';
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.projects_documentStage()} />
						<Select.Content>
							{#each stageCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<Label>{m.projects_documentSource()}</Label>
				<Select.Root
					collection={sourceCollection}
					value={[source]}
					onValueChange={(details: { value: string[] }): void => {
						const next = details.value[0];
						if (next) source = next as Source;
					}}
				>
					<Select.Trigger class="w-full" placeholder={m.projects_documentSource()} />
					<Select.Content>
						{#each sourceCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>

				{#if source === 'url'}
					<Input
						id="document-url"
						type="url"
						bind:value={url}
						aria-label={m.projects_documentUrl()}
						placeholder="https://"
					/>
				{:else}
					<Input id="document-file" type="file" bind:files aria-label={m.projects_documentFile()} />
				{/if}
			</div>

			<div class="grid gap-4 sm:grid-cols-3">
				<div class="flex flex-col gap-2">
					<Label for="document-company">{m.projects_documentCompany()}</Label>
					<Input id="document-company" bind:value={company} autocomplete="off" />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="document-amount">{m.field_amount()}</Label>
					<Input
						id="document-amount"
						class="text-right tabular-nums"
						inputmode="decimal"
						bind:value={amount}
						aria-invalid={amountValid ? undefined : true}
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="document-date">{m.field_date()}</Label>
					<Input id="document-date" type="date" bind:value={occurredOn} />
				</div>
			</div>

			{#if !amountValid}
				<p class="text-error-700-300 text-xs">{m.settings_amountInvalid()}</p>
			{/if}

			<div class="flex flex-col gap-2">
				<Label for="document-notes">{m.field_notes()}</Label>
				<Textarea id="document-notes" bind:value={notes} rows={3} />
			</div>

			<Dialog.Footer class="w-full">
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || !canSubmit}>
					{m.action_add()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
