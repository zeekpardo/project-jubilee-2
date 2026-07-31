<script lang="ts">
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import { getAccessContext } from '$lib/access';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import ContactBackgroundCheckDialog from './ContactBackgroundCheckDialog.svelte';
	import * as m from '$lib/i18n/messages';

	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import PlusIcon from '@lucide/svelte/icons/plus';

	import type { Id } from '$convex/_generated/dataModel';
	import type { ContactBackgroundCheckRow } from './types';

	let { contactId, checks }: { contactId: Id<'contacts'>; checks: ContactBackgroundCheckRow[] } =
		$props();

	const { api } = getAuthContext();
	const client = useConvexClient();
	const access = getAccessContext();

	const canWrite = $derived(access.can('contacts:write'));

	let dialogOpen = $state(false);
	let editing = $state<ContactBackgroundCheckRow | null>(null);
	let deleteOpen = $state(false);
	let deleting = $state<ContactBackgroundCheckRow | null>(null);

	function openAdd(): void {
		editing = null;
		dialogOpen = true;
	}

	function openEdit(row: ContactBackgroundCheckRow): void {
		editing = row;
		dialogOpen = true;
	}

	function openDelete(row: ContactBackgroundCheckRow): void {
		deleting = row;
		deleteOpen = true;
	}

	async function confirmDelete(): Promise<void> {
		const target = deleting;
		if (!target) return;
		await client.mutation(api.contacts.mutations.deleteBackgroundCheck, { checkId: target._id });
	}
</script>

{#if canWrite || checks.length > 0}
	<Card.Root>
		<Card.Header>
			<Card.Title>{m.contactDetail_backgroundChecks()}</Card.Title>
			{#if canWrite}
				<Card.Action>
					<Button variant="outline" size="sm" onclick={openAdd}>
						<PlusIcon class="size-4" aria-hidden="true" />
						{m.action_add()}
					</Button>
				</Card.Action>
			{/if}
		</Card.Header>
		<Card.Content>
			{#if checks.length === 0}
				<EmptyState variant="plain" size="sm" title={m.contactDetail_noBackgroundChecks()} />
			{:else}
				<ul class="divide-border divide-y">
					{#each checks as row (row._id)}
						<li class="flex items-start gap-2 py-2">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<Badge variant={row.cleared ? 'success' : 'destructive'}>
										{row.cleared ? m.contactDetail_cleared() : m.contactDetail_notCleared()}
									</Badge>
									{#if row.completedOn}
										<span class="text-muted-foreground text-xs">
											{m.contactDetail_completedOn()}: {row.completedOn}
										</span>
									{/if}
									{#if row.expiresOn}
										<span class="text-muted-foreground text-xs">
											{m.contactDetail_expiresOn()}: {row.expiresOn}
										</span>
									{/if}
								</div>
								{#if row.note}
									<p class="mt-1 text-sm whitespace-pre-line">{row.note}</p>
								{/if}
							</div>
							{#if canWrite}
								<Button
									size="sm"
									variant="ghost"
									aria-label={m.action_edit()}
									onclick={() => openEdit(row)}
								>
									<PencilIcon />
								</Button>
								<Button
									size="sm"
									variant="ghost"
									aria-label={m.contactDetail_removeBackgroundCheck()}
									onclick={() => openDelete(row)}
								>
									<Trash2Icon />
								</Button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</Card.Content>
	</Card.Root>
{/if}

<ContactBackgroundCheckDialog bind:open={dialogOpen} {contactId} check={editing} />

<ConfirmDialog
	bind:open={deleteOpen}
	title={m.contactDetail_removeBackgroundCheck()}
	body={m.contactDetail_removeBackgroundCheckBody()}
	confirmLabel={m.action_remove()}
	onConfirm={confirmDelete}
/>
