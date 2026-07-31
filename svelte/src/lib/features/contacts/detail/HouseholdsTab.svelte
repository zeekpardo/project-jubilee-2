<script lang="ts">
	import { resolve } from '$app/paths';
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import { getAccessContext } from '$lib/access';
	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import { householdRoleLabel } from '$lib/features/contacts/household-roles';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import * as m from '$lib/i18n/messages';

	import * as Card from '$lib/primitives/ui/card';
	import * as Select from '$lib/primitives/ui/select';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Label } from '$lib/primitives/ui/label';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import StarIcon from '@lucide/svelte/icons/star';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import type { Id } from '$convex/_generated/dataModel';

	let { contactId }: { contactId: Id<'contacts'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();
	const access = getAccessContext();

	const canRead = $derived(access.can('contacts:read'));
	const canWrite = $derived(access.can('contacts:write'));

	const householdsResponse = useQuery(api.contacts.detail.listHouseholdsForContact, () =>
		auth.isAuthenticated && canRead ? { contactId } : 'skip'
	);
	const households = $derived(householdsResponse?.data ?? []);
	const loading = $derived(householdsResponse?.isLoading ?? false);

	const contactsResponse = useQuery(api.contacts.queries.listContacts, () =>
		auth.isAuthenticated && canWrite ? {} : 'skip'
	);
	const contacts = $derived(contactsResponse?.data ?? []);

	const blocks = $derived(
		households.flatMap((row) => {
			const household = row.household;
			if (!household) return [];
			const taken = new Set(row.members.map((member) => member.contactId as string));
			return [
				{
					household,
					membership: row.membership,
					members: row.members,
					picker: createListCollection({
						items: contacts
							.filter((contact) => !taken.has(contact._id as string))
							.map((contact) => ({
								value: contact._id as string,
								label: contactDisplayName(contact)
							}))
					})
				}
			];
		})
	);

	let selected = $state<Record<string, string[]>>({});
	let adding = $state<string | null>(null);
	let confirmOpen = $state(false);
	let removing = $state<Id<'householdMembers'> | null>(null);

	async function setPrimary(householdId: Id<'households'>, primaryContactId: Id<'contacts'>) {
		try {
			await client.mutation(api.households.mutations.updateHousehold, {
				householdId,
				primaryContactId
			});
			toast.success(m.households_saved());
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		}
	}

	async function addMember(householdId: Id<'households'>) {
		const key = householdId as string;
		const picked = selected[key]?.[0];
		if (!picked) return;
		adding = key;
		try {
			await client.mutation(api.households.mutations.addHouseholdMember, {
				householdId,
				contactId: picked as Id<'contacts'>
			});
			selected = { ...selected, [key]: [] };
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			adding = null;
		}
	}

	async function confirmRemove() {
		if (!removing) return;
		await client.mutation(api.households.mutations.removeHouseholdMember, {
			householdMemberId: removing
		});
	}
</script>

{#if loading}
	<div class="flex flex-col gap-2">
		<Skeleton class="h-24 w-full" />
		<Skeleton class="h-24 w-full" />
	</div>
{:else if blocks.length === 0}
	<EmptyState title={m.contactDetail_noHouseholds()} />
{:else}
	<div class="flex flex-col gap-4">
		{#each blocks as block (block.household._id)}
			<Card.Root>
				<Card.Header>
					<Card.Title>
						<a
							class="hover:underline"
							href={resolve('/app/admin/households')}
							title={block.household.name}
						>
							{block.household.name}
						</a>
					</Card.Title>
					<Card.Action>
						<Badge variant="secondary">{householdRoleLabel(block.membership.role)}</Badge>
					</Card.Action>
				</Card.Header>
				<Card.Content class="flex flex-col gap-3">
					{#if block.members.length === 0}
						<EmptyState variant="plain" size="sm" title={m.households_noMembers()} />
					{:else}
						<ul class="divide-border divide-y">
							{#each block.members as member (member._id)}
								{@const isPrimary = block.household.primaryContactId === member.contactId}
								<li class="flex items-center gap-2 py-2">
									<Button
										size="sm"
										variant="ghost"
										aria-label={isPrimary
											? m.contactDetail_primary()
											: m.contactDetail_setPrimary()}
										title={isPrimary ? m.contactDetail_primary() : m.contactDetail_setPrimary()}
										disabled={isPrimary || !canWrite}
										onclick={() => setPrimary(block.household._id, member.contactId)}
									>
										<StarIcon class={isPrimary ? 'fill-current' : ''} />
									</Button>
									<span class="min-w-0 flex-1 truncate">
										{member.contact ? contactDisplayName(member.contact) : '—'}
									</span>
									{#if isPrimary}
										<Badge variant="outline">{m.contactDetail_primary()}</Badge>
									{/if}
									<!-- No remove for the contact this page is about: it would delete the
									     membership the page is currently reading from, under the reader. -->
									{#if canWrite && member.contactId !== contactId}
										<Button
											size="sm"
											variant="ghost"
											aria-label={m.households_removeMember()}
											onclick={() => {
												removing = member._id;
												confirmOpen = true;
											}}
										>
											<Trash2Icon />
										</Button>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}

					{#if canWrite}
						<div class="border-border flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-end">
							<div class="flex flex-1 flex-col gap-1.5">
								<Label>{m.households_addMember()}</Label>
								<Select.Root
									collection={block.picker}
									value={selected[block.household._id as string] ?? []}
									onValueChange={(d: { value: string[] }) =>
										(selected = { ...selected, [block.household._id as string]: d.value })}
								>
									<Select.Trigger
										size="sm"
										placeholder={m.projects_selectContact()}
										class="w-full"
									/>
									<Select.Content>
										{#each block.picker.items as option (option.value)}
											<Select.Item item={option}>
												<Select.ItemText>{option.label}</Select.ItemText>
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
							<Button
								onclick={() => addMember(block.household._id)}
								loading={adding === (block.household._id as string)}
								disabled={(selected[block.household._id as string] ?? []).length === 0}
							>
								{m.action_add()}
							</Button>
						</div>
					{/if}
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
{/if}

<ConfirmDialog
	bind:open={confirmOpen}
	title={m.households_removeMember()}
	body={m.households_removeMemberBody()}
	confirmLabel={m.action_remove()}
	onConfirm={confirmRemove}
/>
