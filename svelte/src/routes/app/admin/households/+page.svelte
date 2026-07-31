<script lang="ts">
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import * as m from '$lib/i18n/messages';

	import HouseholdMembersDialog from '$lib/features/contacts/HouseholdMembersDialog.svelte';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import type { Id } from '$convex/_generated/dataModel';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Badge } from '$lib/primitives/ui/badge';
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

	const householdsResponse = useQuery(api.households.queries.listHouseholds, () =>
		auth.isAuthenticated && canRead ? {} : 'skip'
	);
	const households = $derived(householdsResponse?.data ?? []);
	const loading = $derived(householdsResponse?.isLoading ?? false);

	let dialogOpen = $state(false);
	let saving = $state(false);
	let name = $state('');
	let editingId = $state<Id<'households'> | null>(null);

	let membersOpen = $state(false);
	let membersFor = $state<Id<'households'> | null>(null);
	let confirmOpen = $state(false);
	let deletingId = $state<Id<'households'> | null>(null);

	function openCreate() {
		editingId = null;
		name = '';
		dialogOpen = true;
	}

	function openEdit(household: { _id: Id<'households'>; name: string }) {
		editingId = household._id;
		name = household.name;
		dialogOpen = true;
	}

	function openMembers(id: Id<'households'>) {
		membersFor = id;
		membersOpen = true;
	}

	function openDelete(id: Id<'households'>) {
		deletingId = id;
		confirmOpen = true;
	}

	async function confirmDelete() {
		if (!deletingId) return;
		await client.mutation(api.households.mutations.deleteHousehold, { householdId: deletingId });
	}

	async function saveHousehold(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) return;
		saving = true;
		try {
			if (editingId) {
				await client.mutation(api.households.mutations.updateHousehold, {
					householdId: editingId,
					name: name.trim()
				});
			} else {
				await client.mutation(api.households.mutations.createHousehold, { name: name.trim() });
			}
			toast.success(m.households_saved());
			name = '';
			dialogOpen = false;
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			saving = false;
		}
	}
</script>

<PageContainer title={m.households_title()} description={m.households_subtitle()} access={canRead}>
	{#snippet action()}
		{#if canWrite}
			<Button onclick={openCreate}>{m.households_new()}</Button>
		{/if}
	{/snippet}

	{#if loading}
		<div class="flex flex-col gap-2">
			<Skeleton class="h-10 w-full" />
			<Skeleton class="h-10 w-full" />
		</div>
	{:else if households.length === 0}
		<EmptyState title={m.state_empty()} />
	{:else}
		<div class="overflow-hidden rounded-lg border">
			<Table.Root>
				<Table.Header class="bg-muted">
					<Table.Row>
						<Table.Head>{m.field_name()}</Table.Head>
						<Table.Head>{m.households_members()}</Table.Head>
						<Table.Head class="w-1 text-right">{m.field_actions()}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each households as household (household._id)}
						<Table.Row>
							<Table.Cell class="font-medium">{household.name}</Table.Cell>
							<Table.Cell>
								<Badge variant="secondary">{household.memberCount}</Badge>
							</Table.Cell>
							<Table.Cell class="text-right whitespace-nowrap">
								{#if canWrite}
									<Button size="sm" variant="ghost" onclick={() => openMembers(household._id)}>
										{m.households_members()}
									</Button>
									<Button size="sm" variant="ghost" onclick={() => openEdit(household)}>
										{m.action_edit()}
									</Button>
									<Button size="sm" variant="ghost" onclick={() => openDelete(household._id)}>
										{m.action_delete()}
									</Button>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</PageContainer>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{editingId ? m.households_edit() : m.households_new()}</Dialog.Title>
		</Dialog.Header>
		<form class="flex flex-col gap-4" onsubmit={saveHousehold}>
			<div class="flex flex-col gap-1.5">
				<Label for="household-name">{m.field_name()}</Label>
				<Input id="household-name" bind:value={name} required />
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (dialogOpen = false)}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={saving}>
					{editingId ? m.action_saveChanges() : m.action_create()}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<HouseholdMembersDialog bind:open={membersOpen} householdId={membersFor} />

<ConfirmDialog
	bind:open={confirmOpen}
	title={m.households_delete()}
	body={m.households_deleteBody()}
	onConfirm={confirmDelete}
/>
