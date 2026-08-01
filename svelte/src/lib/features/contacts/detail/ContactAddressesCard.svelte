<script lang="ts">
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import { getAccessContext } from '$lib/access';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import ContactAddressDialog from './ContactAddressDialog.svelte';
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
	import type { ContactAddressRow } from './types';

	let { contactId, addresses }: { contactId: Id<'contacts'>; addresses: ContactAddressRow[] } =
		$props();

	const { api } = getAuthContext();
	const client = useConvexClient();
	const access = getAccessContext();

	const canWrite = $derived(access.can('contacts:write'));

	let dialogOpen = $state(false);
	let editing = $state<ContactAddressRow | null>(null);
	let deleteOpen = $state(false);
	let deleting = $state<ContactAddressRow | null>(null);

	function openAdd(): void {
		editing = null;
		dialogOpen = true;
	}

	function openEdit(row: ContactAddressRow): void {
		editing = row;
		dialogOpen = true;
	}

	function openDelete(row: ContactAddressRow): void {
		deleting = row;
		deleteOpen = true;
	}

	async function setPrimary(addressId: Id<'contactAddresses'>): Promise<void> {
		try {
			await client.mutation(api.contacts.mutations.setPrimaryContactAddress, { addressId });
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		}
	}

	async function confirmDelete(): Promise<void> {
		const target = deleting;
		if (!target) return;
		await client.mutation(api.contacts.mutations.deleteContactAddress, {
			addressId: target._id
		});
	}

	/** `City, State PostalCode` collapses cleanly when only some parts are set. */
	function addressLines(row: ContactAddressRow): string[] {
		const locality = [
			[row.city, row.state].filter((part) => (part ?? '').trim() !== '').join(', '),
			(row.postalCode ?? '').trim()
		]
			.filter((part) => part !== '')
			.join(' ');

		return [row.line1, row.line2, locality, row.countryCode]
			.map((part) => (part ?? '').trim())
			.filter((part) => part !== '');
	}
</script>

{#if canWrite || addresses.length > 0}
	<Card.Root>
		<Card.Header>
			<Card.Title>{m.contactDetail_addresses()}</Card.Title>
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
			{#if addresses.length === 0}
				<EmptyState variant="plain" size="sm" title={m.contactDetail_noAddresses()} />
			{:else}
				<ul>
					{#each addresses as row (row._id)}
						<li class="flex items-start gap-2 py-2">
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
								{#each addressLines(row) as line, index (index)}
									<span class="block truncate">{line}</span>
								{/each}
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
									aria-label={m.contactDetail_removeAddress()}
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

<ContactAddressDialog bind:open={dialogOpen} {contactId} address={editing} />

<ConfirmDialog
	bind:open={deleteOpen}
	title={m.contactDetail_removeAddress()}
	body={m.contactDetail_removeAddressBody()}
	confirmLabel={m.action_remove()}
	onConfirm={confirmDelete}
/>
