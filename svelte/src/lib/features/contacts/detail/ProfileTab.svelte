<script lang="ts">
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import * as m from '$lib/i18n/messages';

	import type { Id } from '$convex/_generated/dataModel';
	import type { ContactDetail } from './types';

	let { contactId }: { contactId: Id<'contacts'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();

	const contactResponse = useQuery(api.contacts.queries.getContact, () =>
		auth.isAuthenticated ? { contactId } : 'skip'
	);
	const contact = $derived(contactResponse.data ?? null);
	const loading = $derived(contactResponse.isLoading);

	const EM_DASH = '—';

	function preferredContactLabel(value: string | undefined): string {
		if (value === 'email') return m.contactDetail_preferred_email();
		if (value === 'mail') return m.contactDetail_preferred_mail();
		if (value === 'phone') return m.contactDetail_preferred_phone();
		return EM_DASH;
	}

	function transparencyLabel(value: string | undefined): string {
		if (value === 'summary') return m.contactDetail_transparency_summary();
		if (value === 'full') return m.contactDetail_transparency_full();
		return EM_DASH;
	}

	function sourceLabel(value: string): string {
		switch (value) {
			case 'sponsor':
				return m.contactDetail_source_sponsor();
			case 'project_member':
				return m.contactDetail_source_project_member();
			case 'subscriber':
				return m.contactDetail_source_subscriber();
			case 'manual':
				return m.contactDetail_source_manual();
			case 'import':
				return m.contactDetail_source_import();
			case 'campaign':
				return m.contactDetail_source_campaign();
			default:
				return value;
		}
	}

	/** `City, State PostalCode` collapses cleanly when only some parts are set. */
	function addressLines(row: NonNullable<ContactDetail>): string[] {
		const locality = [
			[row.city, row.state].filter((part) => (part ?? '').trim() !== '').join(', '),
			(row.postalCode ?? '').trim()
		]
			.filter((part) => part !== '')
			.join(' ');

		return [row.addressLine1, row.addressLine2, locality, row.country]
			.map((part) => (part ?? '').trim())
			.filter((part) => part !== '');
	}

	const rows = $derived(
		contact
			? [
					{ key: 'email', label: m.field_email(), value: contact.email?.trim() || EM_DASH },
					{ key: 'phone', label: m.field_phone(), value: contact.phone?.trim() || EM_DASH },
					{
						key: 'organization',
						label: m.field_organization(),
						value: contact.organization?.trim() || EM_DASH
					},
					{
						key: 'preferredContact',
						label: m.contactDetail_preferredContact(),
						value: preferredContactLabel(contact.preferredContact)
					},
					{
						key: 'transparency',
						label: m.contactDetail_transparency(),
						value: transparencyLabel(contact.transparency)
					}
				]
			: []
	);

	const address = $derived(contact ? addressLines(contact) : []);
</script>

{#if loading}
	<div class="flex flex-col gap-3 pt-2">
		<Skeleton class="h-6 w-1/2" />
		<Skeleton class="h-32 w-full" />
	</div>
{:else if !contact}
	<EmptyState title={m.contactDetail_notFound()} />
{:else}
	<div class="grid gap-4 lg:grid-cols-2">
		<Card.Root>
			<Card.Header>
				<Card.Title>{m.contactDetail_contactInfo()}</Card.Title>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<dl class="flex flex-col gap-3">
					{#each rows as row (row.key)}
						<div class="grid gap-1 sm:grid-cols-3 sm:gap-4">
							<dt class="text-muted-foreground text-sm">{row.label}</dt>
							<dd class="text-sm break-words sm:col-span-2">{row.value}</dd>
						</div>
					{/each}

					<div class="grid gap-1 sm:grid-cols-3 sm:gap-4">
						<dt class="text-muted-foreground text-sm">{m.contactDetail_address()}</dt>
						<dd class="text-sm break-words sm:col-span-2">
							{#if address.length === 0}
								{EM_DASH}
							{:else}
								{#each address as line, index (index)}
									<span class="block">{line}</span>
								{/each}
							{/if}
						</dd>
					</div>
				</dl>

				<div class="border-border flex flex-col gap-3 border-t pt-4">
					<div class="grid gap-1 sm:grid-cols-3 sm:gap-4">
						<span class="text-muted-foreground text-sm">{m.contactDetail_source()}</span>
						<span class="sm:col-span-2">
							{#if contact.source}
								<Badge variant="outline">{sourceLabel(contact.source)}</Badge>
							{:else}
								<span class="text-sm">{EM_DASH}</span>
							{/if}
						</span>
					</div>

					<div class="grid gap-1 sm:grid-cols-3 sm:gap-4">
						<span class="text-muted-foreground text-sm">{m.contactDetail_portalLogin()}</span>
						<span class="sm:col-span-2">
							{#if contact.authUserId}
								<Badge variant="secondary">{m.contactDetail_hasPortalLogin()}</Badge>
							{:else if contact.invitedAt}
								<Badge variant="outline">
									{m.contactDetail_invitedOn()}
									{new Date(contact.invitedAt).toLocaleDateString()}
								</Badge>
							{:else}
								<span class="text-muted-foreground text-sm">{m.contactDetail_noPortalLogin()}</span>
							{/if}
						</span>
					</div>
				</div>
			</Card.Content>
		</Card.Root>

		{#if contact.notes?.trim()}
			<Card.Root>
				<Card.Header>
					<Card.Title>{m.field_notes()}</Card.Title>
				</Card.Header>
				<Card.Content>
					<p class="text-sm whitespace-pre-line">{contact.notes}</p>
				</Card.Content>
			</Card.Root>
		{/if}
	</div>
{/if}
