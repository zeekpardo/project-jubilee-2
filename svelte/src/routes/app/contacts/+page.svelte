<script lang="ts">
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import * as m from '$lib/i18n/messages';

	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import * as Table from '$lib/primitives/ui/table';
	import * as Dialog from '$lib/primitives/ui/dialog';

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();
	const access = getAccessContext();

	const canRead = $derived(access.can('contacts:read'));
	const canWrite = $derived(access.can('contacts:write'));

	let search = $state('');

	const contactsResponse = useQuery(api.contacts.queries.listContacts, () =>
		auth.isAuthenticated && canRead ? { search: search || undefined } : 'skip'
	);
	const contacts = $derived(contactsResponse?.data ?? []);
	const loading = $derived(contactsResponse?.isLoading ?? false);

	let dialogOpen = $state(false);
	let saving = $state(false);
	let firstName = $state('');
	let lastName = $state('');
	let email = $state('');
	let phone = $state('');

	function resetForm() {
		firstName = '';
		lastName = '';
		email = '';
		phone = '';
	}

	async function createContact(event: SubmitEvent) {
		event.preventDefault();
		if (!firstName.trim()) return;
		saving = true;
		try {
			await client.mutation(api.contacts.mutations.createContact, {
				firstName: firstName.trim(),
				lastName: lastName.trim() || undefined,
				email: email.trim() || undefined,
				phone: phone.trim() || undefined
			});
			resetForm();
			dialogOpen = false;
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_error());
		} finally {
			saving = false;
		}
	}
</script>

<PageContainer title={m.contacts_title()} description={m.contacts_subtitle()} access={canRead}>
	{#snippet action()}
		{#if canWrite}
			<Button onclick={() => (dialogOpen = true)}>{m.contacts_new()}</Button>
		{/if}
	{/snippet}

	<div class="max-w-sm">
		<Input bind:value={search} placeholder={m.list_search()} type="search" />
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
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>{m.field_name()}</Table.Head>
					<Table.Head>{m.field_email()}</Table.Head>
					<Table.Head>{m.field_phone()}</Table.Head>
					<Table.Head>{m.field_organization()}</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each contacts as contact (contact._id)}
					<Table.Row>
						<Table.Cell class="font-medium">{contactDisplayName(contact)}</Table.Cell>
						<Table.Cell class="text-muted-foreground">{contact.email ?? '—'}</Table.Cell>
						<Table.Cell class="text-muted-foreground">{contact.phone ?? '—'}</Table.Cell>
						<Table.Cell class="text-muted-foreground">{contact.organization ?? '—'}</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</PageContainer>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.contacts_new()}</Dialog.Title>
		</Dialog.Header>
		<form class="flex flex-col gap-4" onsubmit={createContact}>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-first">{m.field_firstName()}</Label>
					<Input id="contact-first" bind:value={firstName} required />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-last">{m.field_lastName()}</Label>
					<Input id="contact-last" bind:value={lastName} />
				</div>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="contact-email">{m.field_email()}</Label>
				<Input id="contact-email" type="email" bind:value={email} />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="contact-phone">{m.field_phone()}</Label>
				<Input id="contact-phone" bind:value={phone} />
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (dialogOpen = false)}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={saving}>{m.action_create()}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
