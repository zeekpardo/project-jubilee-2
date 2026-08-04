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
	import { Input } from '$lib/primitives/ui/input';
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

	let selected = $state<Record<string, string[]>>({});
	// Captured when a contact is picked so the chosen name survives a later
	// search that no longer returns them.
	let selectedLabels = $state<Record<string, string>>({});
	let searches = $state<Record<string, string>>({});
	let adding = $state<string | null>(null);
	let confirmOpen = $state(false);
	let removing = $state<Id<'householdMembers'> | null>(null);

	// The contact list comes back bounded, so each household's picker searches
	// the org rather than listing it. One shared query feeds every block: only
	// the picker the user is actually in can be typed into, so its term is the
	// one worth spending a subscription on.
	let activePicker = $state<string | null>(null);
	const activeSearch = $derived(activePicker ? (searches[activePicker] ?? '').trim() : '');

	const contactsResponse = useQuery(api.contacts.queries.listContacts, () =>
		auth.isAuthenticated && canWrite ? { search: activeSearch || undefined, limit: 50 } : 'skip'
	);
	const contacts = $derived(contactsResponse?.data ?? []);

	const blocks = $derived(
		households.flatMap((row) => {
			const household = row.household;
			if (!household) return [];
			const key = household._id as string;
			const taken = new Set(row.members.map((member) => member.contactId as string));
			const options = contacts
				.filter((contact) => !taken.has(contact._id as string))
				.map((contact) => ({
					value: contact._id as string,
					label: contactDisplayName(contact)
				}));
			const picked = selected[key]?.[0];
			return [
				{
					key,
					household,
					membership: row.membership,
					members: row.members,
					picker: createListCollection({
						// A pick the current search no longer returns is kept in the list, so
						// the trigger never goes blank on the person Add is about to add.
						items:
							picked !== undefined && !options.some((option) => option.value === picked)
								? [{ value: picked, label: selectedLabels[key] ?? '' }, ...options]
								: options
					})
				}
			];
		})
	);

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
			selectedLabels = { ...selectedLabels, [key]: '' };
			searches = { ...searches, [key]: '' };
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
						<ul>
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
						<!-- Entering this picker at all — the search box or the trigger — makes
						     it the block whose term the shared contact query is running. -->
						<div
							class="border-border flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-end"
							onfocusin={() => (activePicker = block.key)}
						>
							<div class="flex flex-1 flex-col gap-1.5">
								<Label for="household-member-search-{block.key}">{m.households_addMember()}</Label>
								<Input
									id="household-member-search-{block.key}"
									type="search"
									bind:value={searches[block.key]}
									placeholder={m.list_search()}
									autocomplete="off"
								/>
								<Select.Root
									collection={block.picker}
									value={selected[block.key] ?? []}
									onValueChange={(d: { value: string[] }) => {
										selected = { ...selected, [block.key]: d.value };
										const next = d.value[0];
										const label = block.picker.items.find((item) => item.value === next)?.label;
										if (next && label) selectedLabels = { ...selectedLabels, [block.key]: label };
									}}
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
								loading={adding === block.key}
								disabled={(selected[block.key] ?? []).length === 0}
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
