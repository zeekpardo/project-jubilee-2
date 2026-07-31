<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import ContactFormDialog from '$lib/features/contacts/ContactFormDialog.svelte';
	import ProfileTab from '$lib/features/contacts/detail/ProfileTab.svelte';
	import CustomFieldsTab from '$lib/features/contacts/detail/CustomFieldsTab.svelte';
	import GivingTab from '$lib/features/contacts/detail/GivingTab.svelte';
	import HouseholdsTab from '$lib/features/contacts/detail/HouseholdsTab.svelte';
	import CampaignsTab from '$lib/features/contacts/detail/CampaignsTab.svelte';
	import * as m from '$lib/i18n/messages';

	import * as Tabs from '$lib/primitives/ui/tabs';
	import { Button } from '$lib/primitives/ui/button';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import type { Id } from '$convex/_generated/dataModel';

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();

	const contactId = $derived(page.params.id as Id<'contacts'>);
	const canRead = $derived(access.can('contacts:read'));
	const canWrite = $derived(access.can('contacts:write'));

	const contactResponse = useQuery(api.contacts.queries.getContact, () =>
		auth.isAuthenticated && canRead ? { contactId } : 'skip'
	);
	const contact = $derived(contactResponse?.data);
	const loading = $derived(contactResponse?.isLoading ?? false);

	// Tab lives in the URL so a deep link and the back button both work.
	const tab = $derived(page.url.searchParams.get('tab') ?? 'profile');

	const TABS = [
		{ value: 'profile', label: () => m.contactDetail_tab_profile() },
		{ value: 'custom', label: () => m.contactDetail_tab_custom() },
		{ value: 'giving', label: () => m.contactDetail_tab_giving() },
		{ value: 'households', label: () => m.contactDetail_tab_households() },
		{ value: 'campaigns', label: () => m.contactDetail_tab_campaigns() }
	] as const;

	let editOpen = $state(false);
</script>

<PageContainer access={canRead}>
	<div class="flex flex-col gap-1">
		<a
			href={resolve('/app/admin/contacts')}
			class="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
		>
			<ChevronLeftIcon class="size-4" />
			{m.contactDetail_back()}
		</a>

		{#if loading}
			<Skeleton class="h-9 w-64" />
		{:else if !contact}
			<EmptyState title={m.contactDetail_notFound()} />
		{:else}
			<div class="flex items-start justify-between gap-4">
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2">
						<h1 class="truncate text-2xl font-bold tracking-tight lg:text-3xl">
							{contactDisplayName(contact)}
						</h1>
						{#if contact.authUserId}
							<Badge variant="secondary">{m.contactDetail_hasPortalLogin()}</Badge>
						{/if}
					</div>
					{#if contact.organization}
						<p class="text-muted-foreground mt-1 text-sm">{contact.organization}</p>
					{/if}
				</div>
				{#if canWrite}
					<Button onclick={() => (editOpen = true)}>{m.action_edit()}</Button>
				{/if}
			</div>
		{/if}
	</div>

	{#if contact}
		<Tabs.Root value={tab}>
			<Tabs.List>
				{#each TABS as t (t.value)}
					<Tabs.Trigger value={t.value}>{t.label()}</Tabs.Trigger>
				{/each}
			</Tabs.List>

			<Tabs.Content value="profile"><ProfileTab {contactId} /></Tabs.Content>
			<Tabs.Content value="custom"><CustomFieldsTab {contactId} /></Tabs.Content>
			<Tabs.Content value="giving"><GivingTab {contactId} /></Tabs.Content>
			<Tabs.Content value="households"><HouseholdsTab {contactId} /></Tabs.Content>
			<Tabs.Content value="campaigns"><CampaignsTab {contactId} /></Tabs.Content>
		</Tabs.Root>
	{/if}
</PageContainer>

<ContactFormDialog bind:open={editOpen} contact={contact ?? null} />
