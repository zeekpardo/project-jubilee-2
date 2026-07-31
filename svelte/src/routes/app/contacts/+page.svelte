<script lang="ts">
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';
	import { createListCollection } from '@ark-ui/svelte/select';

	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import { CAMPAIGN_ROLES, campaignRoleLabel } from '$lib/features/contacts/campaign-roles';
	import AddCampaignMemberDialog from '$lib/features/contacts/AddCampaignMemberDialog.svelte';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import * as m from '$lib/i18n/messages';

	import { resolve } from '$app/paths';
	import { Button } from '$lib/primitives/ui/button';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import * as Table from '$lib/primitives/ui/table';
	import * as Select from '$lib/primitives/ui/select';
	import type { Id } from '$convex/_generated/dataModel';

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();
	const access = getAccessContext();
	const active = getActiveCampaignContext();

	const campaignId = $derived(active.id as Id<'campaigns'> | null);
	const canRead = $derived(access.can('contacts:read', active.id));
	const canWrite = $derived(access.can('contacts:write', active.id));

	const membersResponse = useQuery(api.campaignMembers.queries.listCampaignMembers, () =>
		auth.isAuthenticated && campaignId && canRead ? { campaignId } : 'skip'
	);
	const members = $derived(membersResponse?.data ?? []);
	const loading = $derived(membersResponse?.isLoading ?? false);
	const memberContactIds = $derived(members.map((row) => row.contactId as string));

	async function addToCampaign(contactId: Id<'contacts'>) {
		if (!campaignId) return;
		try {
			await client.mutation(api.campaignMembers.mutations.addCampaignMember, {
				campaignId,
				contactId
			});
			toast.success(m.campaignContacts_added());
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		}
	}

	const roleCollection = createListCollection({
		items: CAMPAIGN_ROLES.map((value) => ({ value, label: campaignRoleLabel(value) }))
	});

	let addOpen = $state(false);
	let confirmOpen = $state(false);
	let removing = $state<Id<'campaignMemberships'> | null>(null);

	async function changeRole(membershipId: Id<'campaignMemberships'>, role: string) {
		try {
			await client.mutation(api.campaignMembers.mutations.updateCampaignMemberRole, {
				membershipId,
				role
			});
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		}
	}

	async function confirmRemove() {
		if (!removing) return;
		await client.mutation(api.campaignMembers.mutations.removeCampaignMember, {
			membershipId: removing
		});
		toast.success(m.campaignContacts_removed());
	}
</script>

<PageContainer
	title={m.campaignContacts_title()}
	description={m.campaignContacts_subtitle()}
	access={canRead}
>
	{#snippet action()}
		{#if canWrite && campaignId}
			<Button onclick={() => (addOpen = true)}>{m.campaignContacts_add()}</Button>
		{/if}
	{/snippet}

	{#if !campaignId}
		<EmptyState title={m.shell_noCampaigns()} />
	{:else if loading}
		<div class="flex flex-col gap-2">
			<Skeleton class="h-10 w-full" />
			<Skeleton class="h-10 w-full" />
		</div>
	{:else if members.length === 0}
		<EmptyState title={m.campaignContacts_empty()} description={m.campaignContacts_emptyBody()} />
	{:else}
		<div class="overflow-hidden rounded-lg border">
			<Table.Root>
				<Table.Header class="bg-muted">
					<Table.Row>
						<Table.Head>{m.field_name()}</Table.Head>
						<Table.Head>{m.field_email()}</Table.Head>
						<Table.Head>{m.field_role()}</Table.Head>
						<Table.Head class="w-1 text-right">{m.field_actions()}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each members as member (member.contactId)}
						<Table.Row>
							<Table.Cell class="font-medium">
								{#if member.contact}
									<a
										href={resolve('/app/admin/contacts/[id]', { id: member.contact._id })}
										class="hover:underline"
									>
										{contactDisplayName(member.contact)}
									</a>
								{:else}
									—
								{/if}
								{#if member.viaProjects.length > 0}
									<span class="text-muted-foreground block text-xs">
										{m.campaignContacts_via()}
										{member.viaProjects.map((p) => `${p.number} ${p.name}`).join(', ')}
									</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{member.contact?.email ?? '—'}</Table.Cell>
							<Table.Cell>
								{#if member.membershipId === null}
									<span class="text-muted-foreground text-sm">{m.campaignContacts_viaOnly()}</span>
								{:else if canWrite}
									<Select.Root
										collection={roleCollection}
										value={[member.role ?? 'attendee']}
										onValueChange={(d: { value: string[] }) => {
											const next = d.value[0];
											if (next && next !== member.role && member.membershipId) {
												changeRole(member.membershipId, next);
											}
										}}
									>
										<Select.Trigger size="sm" class="w-40" />
										<Select.Content>
											{#each roleCollection.items as option (option.value)}
												<Select.Item item={option}>
													<Select.ItemText>{option.label}</Select.ItemText>
												</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								{:else}
									<span class="text-muted-foreground">{campaignRoleLabel(member.role ?? '')}</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right whitespace-nowrap">
								{#if canWrite && member.membershipId === null}
									<Button
										size="sm"
										variant="outline"
										onclick={() => addToCampaign(member.contactId)}
									>
										{m.campaignContacts_addToCampaign()}
									</Button>
								{:else if canWrite && member.membershipId}
									<Button
										size="sm"
										variant="ghost"
										onclick={() => {
											removing = member.membershipId;
											confirmOpen = true;
										}}
									>
										{m.action_remove()}
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

<AddCampaignMemberDialog bind:open={addOpen} {campaignId} {memberContactIds} />

<ConfirmDialog
	bind:open={confirmOpen}
	title={m.action_remove()}
	body={m.campaignContacts_removeBody()}
	confirmLabel={m.action_remove()}
	onConfirm={confirmRemove}
/>
