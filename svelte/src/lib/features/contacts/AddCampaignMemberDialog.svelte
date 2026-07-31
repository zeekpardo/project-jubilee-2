<script lang="ts">
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Tabs from '$lib/primitives/ui/tabs';
	import * as Select from '$lib/primitives/ui/select';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import * as m from '$lib/i18n/messages';

	import { contactDisplayName } from './contact-name';
	import { CAMPAIGN_ROLES, campaignRoleLabel } from './campaign-roles';
	import type { Id } from '$convex/_generated/dataModel';

	let {
		open = $bindable(false),
		campaignId,
		memberContactIds = []
	}: {
		open?: boolean;
		campaignId: Id<'campaigns'> | null;
		memberContactIds?: string[];
	} = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	const contactsResponse = useQuery(api.contacts.queries.listContacts, () =>
		auth.isAuthenticated && open ? {} : 'skip'
	);
	const contacts = $derived(contactsResponse?.data ?? []);

	// Anyone already in the campaign is not offered again.
	const available = $derived(contacts.filter((c) => !memberContactIds.includes(c._id as string)));

	const contactCollection = $derived(
		createListCollection({
			items: available.map((c) => ({ value: c._id as string, label: contactDisplayName(c) }))
		})
	);
	const roleCollection = createListCollection({
		items: CAMPAIGN_ROLES.map((value) => ({ value, label: campaignRoleLabel(value) }))
	});

	let selectedContact = $state<string[]>([]);
	let role = $state<string[]>(['attendee']);
	let firstName = $state('');
	let lastName = $state('');
	let email = $state('');
	let phone = $state('');
	let saving = $state(false);
	let errorMessage = $state('');

	function reset() {
		selectedContact = [];
		role = ['attendee'];
		firstName = '';
		lastName = '';
		email = '';
		phone = '';
		errorMessage = '';
	}

	async function addExisting() {
		const contactId = selectedContact[0];
		if (!campaignId || !contactId) return;
		saving = true;
		errorMessage = '';
		try {
			await client.mutation(api.campaignMembers.mutations.addCampaignMember, {
				campaignId,
				contactId: contactId as Id<'contacts'>,
				role: role[0] ?? 'attendee'
			});
			toast.success(m.campaignContacts_added());
			reset();
			open = false;
		} catch (error) {
			errorMessage = error instanceof ConvexError ? String(error.data) : m.state_saveFailed();
		} finally {
			saving = false;
		}
	}

	async function createAndAdd(event: SubmitEvent) {
		event.preventDefault();
		if (!campaignId || !firstName.trim()) return;
		saving = true;
		errorMessage = '';
		try {
			await client.mutation(api.campaignMembers.mutations.createCampaignMember, {
				campaignId,
				firstName: firstName.trim(),
				lastName: lastName.trim() || undefined,
				email: email.trim() || undefined,
				phone: phone.trim() || undefined,
				role: role[0] ?? 'attendee'
			});
			toast.success(m.campaignContacts_added());
			reset();
			open = false;
		} catch (error) {
			errorMessage = error instanceof ConvexError ? String(error.data) : m.state_saveFailed();
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.campaignContacts_add()}</Dialog.Title>
		</Dialog.Header>

		<div class="flex flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<Label>{m.field_role()}</Label>
				<Select.Root
					collection={roleCollection}
					value={role}
					onValueChange={(d: { value: string[] }) => (role = d.value)}
				>
					<Select.Trigger size="sm" class="w-full" />
					<Select.Content>
						{#each roleCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<Tabs.Root value="existing">
				<Tabs.List>
					<Tabs.Trigger value="existing">{m.campaignContacts_chooseExisting()}</Tabs.Trigger>
					<Tabs.Trigger value="new">{m.campaignContacts_createNew()}</Tabs.Trigger>
				</Tabs.List>

				<Tabs.Content value="existing">
					<div class="flex flex-col gap-4 pt-2">
						{#if available.length === 0}
							<p class="text-muted-foreground text-sm">{m.campaignContacts_alreadyIn()}</p>
						{:else}
							<div class="flex flex-col gap-1.5">
								<Label>{m.campaignContacts_allContacts()}</Label>
								<Select.Root
									collection={contactCollection}
									value={selectedContact}
									onValueChange={(d: { value: string[] }) => (selectedContact = d.value)}
								>
									<Select.Trigger
										size="sm"
										placeholder={m.projects_selectContact()}
										class="w-full"
									/>
									<Select.Content>
										{#each contactCollection.items as option (option.value)}
											<Select.Item item={option}>
												<Select.ItemText>{option.label}</Select.ItemText>
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
							<div class="flex justify-end">
								<Button
									onclick={addExisting}
									loading={saving}
									disabled={selectedContact.length === 0}
								>
									{m.action_add()}
								</Button>
							</div>
						{/if}
					</div>
				</Tabs.Content>

				<Tabs.Content value="new">
					<form class="flex flex-col gap-4 pt-2" onsubmit={createAndAdd}>
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="flex flex-col gap-1.5">
								<Label for="cm-first">{m.field_firstName()}</Label>
								<Input id="cm-first" bind:value={firstName} required />
							</div>
							<div class="flex flex-col gap-1.5">
								<Label for="cm-last">{m.field_lastName()}</Label>
								<Input id="cm-last" bind:value={lastName} />
							</div>
						</div>
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="flex flex-col gap-1.5">
								<Label for="cm-email">{m.field_email()}</Label>
								<Input id="cm-email" type="email" bind:value={email} />
							</div>
							<div class="flex flex-col gap-1.5">
								<Label for="cm-phone">{m.field_phone()}</Label>
								<Input id="cm-phone" bind:value={phone} />
							</div>
						</div>
						<div class="flex justify-end">
							<Button type="submit" loading={saving}>{m.action_create()}</Button>
						</div>
					</form>
				</Tabs.Content>
			</Tabs.Root>

			{#if errorMessage}
				<p class="text-destructive text-sm">{errorMessage}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>{m.action_cancel()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
