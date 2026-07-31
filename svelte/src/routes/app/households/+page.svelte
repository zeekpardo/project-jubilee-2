<script lang="ts">
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import * as m from '$lib/i18n/messages';

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

	async function createHousehold(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) return;
		saving = true;
		try {
			await client.mutation(api.households.mutations.createHousehold, { name: name.trim() });
			name = '';
			dialogOpen = false;
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_error());
		} finally {
			saving = false;
		}
	}
</script>

<PageContainer title={m.households_title()} description={m.households_subtitle()} access={canRead}>
	{#snippet action()}
		{#if canWrite}
			<Button onclick={() => (dialogOpen = true)}>{m.households_new()}</Button>
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
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>{m.field_name()}</Table.Head>
					<Table.Head>{m.households_members()}</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each households as household (household._id)}
					<Table.Row>
						<Table.Cell class="font-medium">{household.name}</Table.Cell>
						<Table.Cell>
							<Badge variant="secondary">{household.memberCount}</Badge>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	{/if}
</PageContainer>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.households_new()}</Dialog.Title>
		</Dialog.Header>
		<form class="flex flex-col gap-4" onsubmit={createHousehold}>
			<div class="flex flex-col gap-1.5">
				<Label for="household-name">{m.field_name()}</Label>
				<Input id="household-name" bind:value={name} required />
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
