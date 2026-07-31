<script lang="ts">
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import * as Table from '$lib/primitives/ui/table';
	import { Button } from '$lib/primitives/ui/button';
	import { Label } from '$lib/primitives/ui/label';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import * as m from '$lib/i18n/messages';

	import { contactDisplayName } from './contact-name';
	import { householdRoleLabel, HOUSEHOLD_ROLES, type HouseholdRole } from './household-roles';
	import type { Id } from '$convex/_generated/dataModel';

	let {
		open = $bindable(false),
		householdId
	}: {
		open?: boolean;
		householdId: Id<'households'> | null;
	} = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	const householdResponse = useQuery(api.households.queries.getHousehold, () =>
		auth.isAuthenticated && open && householdId ? { householdId } : 'skip'
	);
	const household = $derived(householdResponse?.data);

	const contactsResponse = useQuery(api.contacts.queries.listContacts, () =>
		auth.isAuthenticated && open ? {} : 'skip'
	);
	const contacts = $derived(contactsResponse?.data ?? []);

	// Anyone already in the household is not offered again; the pair is unique.
	const available = $derived(
		contacts.filter((c) => !(household?.members ?? []).some((mem) => mem.contactId === c._id))
	);

	const contactCollection = $derived(
		createListCollection({
			items: available.map((c) => ({ value: c._id as string, label: contactDisplayName(c) }))
		})
	);
	const roleCollection = createListCollection({
		items: HOUSEHOLD_ROLES.map((value) => ({ value, label: householdRoleLabel(value) }))
	});

	let selectedContact = $state<string[]>([]);
	let selectedRole = $state<string[]>(['adult']);
	let working = $state(false);

	async function addMember() {
		const contactId = selectedContact[0];
		if (!householdId || !contactId) return;
		working = true;
		try {
			await client.mutation(api.households.mutations.addHouseholdMember, {
				householdId,
				contactId: contactId as Id<'contacts'>,
				role: (selectedRole[0] ?? 'adult') as HouseholdRole
			});
			selectedContact = [];
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			working = false;
		}
	}

	async function changeRole(householdMemberId: Id<'householdMembers'>, role: string) {
		try {
			await client.mutation(api.households.mutations.updateHouseholdMember, {
				householdMemberId,
				role: role as HouseholdRole
			});
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		}
	}

	async function removeMember(householdMemberId: Id<'householdMembers'>) {
		try {
			await client.mutation(api.households.mutations.removeHouseholdMember, { householdMemberId });
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{household?.name ?? m.households_members()}</Dialog.Title>
		</Dialog.Header>

		<div class="flex flex-col gap-4">
			{#if (household?.members ?? []).length === 0}
				<EmptyState variant="plain" size="sm" title={m.households_noMembers()} />
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>{m.field_name()}</Table.Head>
							<Table.Head>{m.households_role()}</Table.Head>
							<Table.Head class="w-1 text-right">{m.field_actions()}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each household?.members ?? [] as member (member._id)}
							<Table.Row>
								<Table.Cell class="font-medium">
									{member.contact ? contactDisplayName(member.contact) : '—'}
								</Table.Cell>
								<Table.Cell>
									<Select.Root
										collection={roleCollection}
										value={[member.role]}
										onValueChange={(d: { value: string[] }) => {
											const next = d.value[0];
											if (next && next !== member.role) changeRole(member._id, next);
										}}
									>
										<Select.Trigger size="sm" class="w-44" />
										<Select.Content>
											{#each roleCollection.items as option (option.value)}
												<Select.Item item={option}>
													<Select.ItemText>{option.label}</Select.ItemText>
												</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								</Table.Cell>
								<Table.Cell class="text-right">
									<Button size="sm" variant="ghost" onclick={() => removeMember(member._id)}>
										{m.action_remove()}
									</Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}

			<div class="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end">
				<div class="flex flex-1 flex-col gap-1.5">
					<Label>{m.households_addMember()}</Label>
					<Select.Root
						collection={contactCollection}
						value={selectedContact}
						onValueChange={(d: { value: string[] }) => (selectedContact = d.value)}
					>
						<Select.Trigger size="sm" placeholder={m.projects_selectContact()} class="w-full" />
						<Select.Content>
							{#each contactCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-1.5 sm:w-48">
					<Label>{m.households_role()}</Label>
					<Select.Root
						collection={roleCollection}
						value={selectedRole}
						onValueChange={(d: { value: string[] }) => (selectedRole = d.value)}
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
				<Button onclick={addMember} loading={working} disabled={selectedContact.length === 0}>
					{m.action_add()}
				</Button>
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>{m.action_done()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
