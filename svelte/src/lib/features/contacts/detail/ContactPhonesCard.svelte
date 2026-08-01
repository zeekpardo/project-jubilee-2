<script lang="ts">
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import { getAccessContext } from '$lib/access';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import ContactPhoneDialog from './ContactPhoneDialog.svelte';
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
	import type { ContactPhoneRow } from './types';

	let { contactId, phones }: { contactId: Id<'contacts'>; phones: ContactPhoneRow[] } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();
	const access = getAccessContext();

	const canWrite = $derived(access.can('contacts:write'));

	let dialogOpen = $state(false);
	let editing = $state<ContactPhoneRow | null>(null);
	let deleteOpen = $state(false);
	let deleting = $state<ContactPhoneRow | null>(null);

	function openAdd(): void {
		editing = null;
		dialogOpen = true;
	}

	function openEdit(row: ContactPhoneRow): void {
		editing = row;
		dialogOpen = true;
	}

	function openDelete(row: ContactPhoneRow): void {
		deleting = row;
		deleteOpen = true;
	}

	async function setPrimary(phoneId: Id<'contactPhones'>): Promise<void> {
		try {
			await client.mutation(api.contacts.mutations.setPrimaryContactPhone, { phoneId });
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		}
	}

	async function confirmDelete(): Promise<void> {
		const target = deleting;
		if (!target) return;
		await client.mutation(api.contacts.mutations.deleteContactPhone, { phoneId: target._id });
	}
</script>

{#if canWrite || phones.length > 0}
	<Card.Root>
		<Card.Header>
			<Card.Title>{m.contactDetail_phones()}</Card.Title>
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
			{#if phones.length === 0}
				<EmptyState variant="plain" size="sm" title={m.contactDetail_noPhones()} />
			{:else}
				<ul>
					{#each phones as row (row._id)}
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
								<span class="block truncate">{row.number}</span>
								{#if row.carrier}
									<span class="text-muted-foreground block truncate text-xs">{row.carrier}</span>
								{/if}
							</div>
							<Badge variant="outline">{contactLocationLabel(row.location)}</Badge>
							{#if row.isPrimary}
								<Badge variant="secondary">{m.contactDetail_primary()}</Badge>
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
									aria-label={m.contactDetail_removePhone()}
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

<ContactPhoneDialog bind:open={dialogOpen} {contactId} phone={editing} />

<ConfirmDialog
	bind:open={deleteOpen}
	title={m.contactDetail_removePhone()}
	body={m.contactDetail_removePhoneBody()}
	confirmLabel={m.action_remove()}
	onConfirm={confirmDelete}
/>
