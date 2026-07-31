<script lang="ts">
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';

	import { useQuery } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import * as m from '$lib/i18n/messages';
	import type { ProjectDocumentRow } from './types';

	let { document }: { document: ProjectDocumentRow } = $props();

	const { api } = getAuthContext();

	// Storage URLs are signed and expire, so the row alone cannot render a link —
	// only the single-document read hands one back.
	const fileResponse = useQuery(api.documents.queries.getDocument, () =>
		document.storageId === undefined ? 'skip' : { documentId: document._id }
	);

	const fileUrl = $derived(fileResponse.data?.fileUrl ?? null);
</script>

<!-- Both destinations leave the app: an admin-entered URL, or a signed storage URL. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
{#if document.url}
	<a
		class="text-primary inline-flex items-center gap-1 hover:underline"
		href={document.url}
		target="_blank"
		rel="noopener noreferrer"
	>
		<ExternalLinkIcon class="size-3.5" aria-hidden="true" />
		{m.projects_documentUrl()}
	</a>
{:else if fileUrl}
	<a
		class="text-primary inline-flex items-center gap-1 hover:underline"
		href={fileUrl}
		target="_blank"
		rel="noopener noreferrer"
	>
		<PaperclipIcon class="size-3.5" aria-hidden="true" />
		{m.projects_documentFile()}
	</a>
{:else}
	<span class="text-muted-foreground" aria-hidden="true">—</span>
{/if}
