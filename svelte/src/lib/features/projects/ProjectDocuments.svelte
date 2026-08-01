<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc } from '$convex/_generated/dataModel';

	import { Can } from '$lib/access';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import type { PipelineStage } from '$lib/domain/stages';
	import * as m from '$lib/i18n/messages';
	import { documentKindLabel } from './labels';
	import { mergeProjectDocumentRows } from './document-rows';
	import { formatCents } from './format';
	import ProjectDocumentDialog from './ProjectDocumentDialog.svelte';
	import ProjectDocumentLink from './ProjectDocumentLink.svelte';
	import StageBadge from './StageBadge.svelte';
	import type { ProjectDocumentRow, ProjectLedgerReceiptRow } from './types';

	let { project, stages }: { project: Doc<'projects'>; stages: PipelineStage[] } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const documentsResponse = useQuery(api.documents.queries.listDocumentsForProject, () => ({
		projectId: project._id
	}));
	const documents = $derived(documentsResponse.data ?? []);

	// Receipts attached by Record spend / Record donation. They are shown here,
	// never copied here: each one still belongs to its transaction, which is why
	// these rows carry no edit or delete controls.
	const receiptsResponse = useQuery(api.allocations.queries.getLedgerReceiptsForProject, () => ({
		projectId: project._id
	}));
	const receipts = $derived(receiptsResponse.data ?? []);

	const rows = $derived(
		mergeProjectDocumentRows<ProjectDocumentRow, ProjectLedgerReceiptRow>(documents, receipts)
	);
	const loading = $derived(documentsResponse.isLoading || receiptsResponse.isLoading);

	let dialogOpen = $state(false);
	let deleteOpen = $state(false);
	let deleting = $state<ProjectDocumentRow | null>(null);

	function openDelete(document: ProjectDocumentRow): void {
		deleting = document;
		deleteOpen = true;
	}

	async function deleteDocument(): Promise<void> {
		const target = deleting;
		if (!target) return;
		await client.mutation(api.documents.mutations.deleteDocument, { documentId: target._id });
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.projects_documents()}</Card.Title>
		<Can do="projects:write" campaignId={project.campaignId}>
			<Card.Action>
				<Button
					variant="outline"
					size="sm"
					disabled={stages.length === 0}
					onclick={() => (dialogOpen = true)}
				>
					<PlusIcon class="size-4" aria-hidden="true" />
					{m.projects_addDocument()}
				</Button>
			</Card.Action>
		</Can>
	</Card.Header>
	<Card.Content>
		{#if loading}
			<div class="flex flex-col gap-3">
				<Skeleton class="h-8 w-full" />
				<Skeleton class="h-8 w-full" />
				<Skeleton class="h-8 w-full" />
			</div>
		{:else if rows.length === 0}
			<EmptyState variant="plain" size="sm" title={m.projects_noDocuments()} />
		{:else}
			<Table.Root>
				<Table.Header class="bg-muted">
					<Table.Row>
						<Table.Head>{m.projects_documentKind()}</Table.Head>
						<Table.Head>{m.projects_documentStage()}</Table.Head>
						<Table.Head>{m.projects_documentCompany()}</Table.Head>
						<Table.Head class="text-right">{m.field_amount()}</Table.Head>
						<Table.Head>{m.field_date()}</Table.Head>
						<Table.Head>{m.projects_documentSource()}</Table.Head>
						<Table.Head class="w-16 text-right">{m.field_actions()}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows as row (row.key)}
						{#if row.source === 'document'}
							{@const document = row.document}
							<Table.Row>
								<Table.Cell>
									<Badge variant="secondary">{documentKindLabel(document.kind)}</Badge>
								</Table.Cell>
								<Table.Cell><StageBadge stage={document.stage} {stages} /></Table.Cell>
								<Table.Cell class="text-muted-foreground">{document.company ?? '—'}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">
									{document.amountCents === undefined ? '—' : formatCents(document.amountCents)}
								</Table.Cell>
								<Table.Cell class="text-muted-foreground tabular-nums">
									{document.occurredOn ?? '—'}
								</Table.Cell>
								<Table.Cell><ProjectDocumentLink {document} /></Table.Cell>
								<Table.Cell class="text-right">
									<Can do="projects:write" campaignId={project.campaignId}>
										<Button
											variant="ghost"
											size="icon"
											aria-label={m.projects_deleteDocument()}
											title={m.projects_deleteDocument()}
											onclick={() => openDelete(document)}
										>
											<Trash2Icon class="size-4" aria-hidden="true" />
										</Button>
									</Can>
								</Table.Cell>
							</Table.Row>
						{:else}
							{@const receipt = row.receipt}
							<!-- A ledger receipt. No stage, no company, and deliberately no
							controls: the transaction owns this file, so editing or deleting it
							happens where the money was recorded. -->
							<Table.Row>
								<Table.Cell>
									<div class="flex flex-wrap items-center gap-1.5">
										<Badge variant="secondary">{m.projects_documentKind_receipt()}</Badge>
										<Badge variant="outline" title={m.projects_documentLedgerHint()}>
											{m.projects_documentFromLedger()}
										</Badge>
									</div>
								</Table.Cell>
								<Table.Cell class="text-muted-foreground">—</Table.Cell>
								<Table.Cell class="text-muted-foreground">—</Table.Cell>
								<Table.Cell class="text-right tabular-nums">
									{formatCents(receipt.amountCents)}
								</Table.Cell>
								<Table.Cell class="text-muted-foreground tabular-nums">
									{receipt.occurredOn ?? '—'}
								</Table.Cell>
								<Table.Cell>
									<!-- A signed storage URL, so it leaves the app exactly as the
									document links above do. -->
									<!-- eslint-disable svelte/no-navigation-without-resolve -->
									<a
										class="text-primary inline-flex items-center gap-1 hover:underline"
										href={receipt.receiptUrl}
										target="_blank"
										rel="noopener noreferrer"
									>
										<PaperclipIcon class="size-3.5" aria-hidden="true" />
										{m.projects_documentFile()}
									</a>
								</Table.Cell>
								<Table.Cell></Table.Cell>
							</Table.Row>
						{/if}
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</Card.Content>
</Card.Root>

<ProjectDocumentDialog
	bind:open={dialogOpen}
	projectId={project._id}
	{stages}
	defaultStage={project.stage}
/>

<ConfirmDialog
	bind:open={deleteOpen}
	title={m.projects_deleteDocument()}
	body={m.projects_documentDeleteBody()}
	onConfirm={deleteDocument}
/>
