<script lang="ts">
	import { usePaginatedQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { toast } from 'svelte-sonner';

	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import * as m from '$lib/i18n/messages';

	import ContactFormDialog from '$lib/features/contacts/ContactFormDialog.svelte';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import type { ContactRow } from '$lib/features/contacts/types';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import * as Table from '$lib/primitives/ui/table';

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();
	const access = getAccessContext();

	const canRead = $derived(access.can('contacts:read'));
	const canWrite = $derived(access.can('contacts:write'));

	let search = $state('');
	let appliedSearch = $state('');

	// The subscription's args are what re-run the query, so binding it to the
	// input directly would open a new server subscription on every keystroke.
	$effect(() => {
		const next = search;
		const timer = setTimeout(() => (appliedSearch = next), 250);
		return () => clearTimeout(timer);
	});

	// Paginated, not bounded: this is the only screen for finding a specific
	// person, so a cap that silently hid contacts past it would defeat the page.
	const contactsPage = usePaginatedQuery(
		api.contacts.queries.pageContacts,
		() => (auth.isAuthenticated && canRead ? { search: appliedSearch || undefined } : 'skip'),
		{ initialNumItems: 25 }
	);
	const contacts = $derived(contactsPage.results ?? []);
	const loading = $derived(contactsPage.status === 'LoadingFirstPage');

	let formOpen = $state(false);
	let editing = $state<ContactRow | null>(null);
	let confirmOpen = $state(false);
	let deleting = $state<ContactRow | null>(null);

	function openCreate() {
		editing = null;
		formOpen = true;
	}

	function openEdit(contact: ContactRow) {
		editing = contact;
		formOpen = true;
	}

	function openDelete(contact: ContactRow) {
		deleting = contact;
		confirmOpen = true;
	}

	async function confirmDelete() {
		if (!deleting) return;
		await client.mutation(api.contacts.mutations.deleteContact, { contactId: deleting._id });
		toast.success(m.contacts_saved());
	}
</script>

<PageContainer title={m.contacts_title()} description={m.contacts_subtitle()} access={canRead}>
	{#snippet action()}
		{#if canWrite}
			<Button onclick={openCreate}>{m.contacts_new()}</Button>
		{/if}
	{/snippet}

	<div class="flex w-full items-start justify-between gap-2 p-1">
		<div class="flex flex-1 flex-wrap items-center gap-2">
			<Input
				bind:value={search}
				placeholder={m.list_search()}
				type="search"
				class="h-8 w-40 lg:w-56"
			/>
		</div>
	</div>

	{#if loading}
		<div class="flex flex-col gap-2">
			<Skeleton class="h-10 w-full" />
			<Skeleton class="h-10 w-full" />
			<Skeleton class="h-10 w-full" />
		</div>
	{:else if contacts.length === 0}
		<EmptyState title={m.contacts_empty()} />
	{:else}
		<div class="overflow-hidden rounded-lg border">
			<Table.Root>
				<Table.Header class="bg-muted">
					<Table.Row>
						<Table.Head>{m.field_name()}</Table.Head>
						<Table.Head>{m.field_email()}</Table.Head>
						<Table.Head>{m.field_phone()}</Table.Head>
						<Table.Head>{m.field_organization()}</Table.Head>
						<Table.Head class="w-1 text-right">{m.field_actions()}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each contacts as contact (contact._id)}
						<Table.Row>
							<Table.Cell class="font-medium">
								<a
									href={resolve('/app/admin/contacts/[id]', { id: contact._id })}
									class="hover:underline"
								>
									{contactDisplayName(contact)}
								</a>
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{contact.email ?? '—'}</Table.Cell>
							<Table.Cell class="text-muted-foreground">{contact.phone ?? '—'}</Table.Cell>
							<Table.Cell class="text-muted-foreground">{contact.organization ?? '—'}</Table.Cell>
							<Table.Cell class="text-right whitespace-nowrap">
								{#if canWrite}
									<Button size="sm" variant="ghost" onclick={() => openEdit(contact)}>
										{m.action_edit()}
									</Button>
									<Button size="sm" variant="ghost" onclick={() => openDelete(contact)}>
										{m.action_delete()}
									</Button>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>

		{#if contactsPage.status === 'CanLoadMore' || contactsPage.status === 'LoadingMore'}
			<div class="flex justify-center pt-3">
				<Button
					variant="outline"
					onclick={() => contactsPage.loadMore(25)}
					loading={contactsPage.status === 'LoadingMore'}
					disabled={contactsPage.status === 'LoadingMore'}
				>
					{m.donations_loadMore()}
				</Button>
			</div>
		{/if}
	{/if}
</PageContainer>

<ContactFormDialog bind:open={formOpen} contact={editing} />

<ConfirmDialog
	bind:open={confirmOpen}
	title={m.contacts_delete()}
	body={m.contacts_deleteBody()}
	onConfirm={confirmDelete}
/>
