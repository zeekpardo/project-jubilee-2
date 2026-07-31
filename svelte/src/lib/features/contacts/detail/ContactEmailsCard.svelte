<script lang="ts">
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import { getAccessContext } from '$lib/access';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import ContactEmailDialog from './ContactEmailDialog.svelte';
	import { contactLocationLabel } from '../contact-info-labels';
	import * as m from '$lib/i18n/messages';

	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import StarIcon from '@lucide/svelte/icons/star';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import PlusIcon from '@lucide/svelte/icons/plus';

	import type { Id } from '$convex/_generated/dataModel';
	import type { ContactEmailRow } from './types';

	let { contactId, emails }: { contactId: Id<'contacts'>; emails: ContactEmailRow[] } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();
	const access = getAccessContext();

	const canWrite = $derived(access.can('contacts:write'));

	let dialogOpen = $state(false);
	let editing = $state<ContactEmailRow | null>(null);
	let deleteOpen = $state(false);
	let deleting = $state<ContactEmailRow | null>(null);

	function openAdd(): void {
		editing = null;
		dialogOpen = true;
	}

	function openEdit(row: ContactEmailRow): void {
		editing = row;
		dialogOpen = true;
	}

	function openDelete(row: ContactEmailRow): void {
		deleting = row;
		deleteOpen = true;
	}

	async function setPrimary(emailId: Id<'contactEmails'>): Promise<void> {
		try {
			await client.mutation(api.contacts.mutations.setPrimaryContactEmail, { emailId });
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		}
	}

	async function confirmDelete(): Promise<void> {
		const target = deleting;
		if (!target) return;
		await client.mutation(api.contacts.mutations.deleteContactEmail, { emailId: target._id });
	}
</script>

{#if canWrite || emails.length > 0}
	<Card.Root>
		<Card.Header>
			<Card.Title>{m.contactDetail_emails()}</Card.Title>
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
			{#if emails.length === 0}
				<EmptyState variant="plain" size="sm" title={m.contactDetail_noEmails()} />
			{:else}
				<ul class="divide-border divide-y">
					{#each emails as row (row._id)}
						<li class="flex items-center gap-2 py-2">
							{#if canWrite}
								<Button
									size="sm"
									variant="ghost"
									aria-label={row.isPrimary
										? m.contactDetail_primary()
										: m.contactDetail_setPrimary()}
									title={row.isPrimary ? m.contactDetail_primary() : m.contactDetail_setPrimary()}
									disabled={row.isPrimary}
									onclick={() => setPrimary(row._id)}
								>
									<StarIcon class={row.isPrimary ? 'fill-current' : ''} />
								</Button>
							{/if}
							<div class="min-w-0 flex-1">
								<span class="block truncate">{row.address}</span>
							</div>
							<Badge variant="outline">{contactLocationLabel(row.location)}</Badge>
							{#if row.isPrimary}
								<Badge variant="secondary">{m.contactDetail_primary()}</Badge>
							{/if}
							{#if row.blocked}
								<Badge variant="warning">{m.contactDetail_blocked()}</Badge>
							{/if}
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
									aria-label={m.contactDetail_removeEmail()}
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

<ContactEmailDialog bind:open={dialogOpen} {contactId} email={editing} />

<ConfirmDialog
	bind:open={deleteOpen}
	title={m.contactDetail_removeEmail()}
	body={m.contactDetail_removeEmailBody()}
	confirmLabel={m.action_remove()}
	onConfirm={confirmDelete}
/>
