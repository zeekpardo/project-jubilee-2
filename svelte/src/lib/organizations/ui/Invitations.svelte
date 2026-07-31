<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button, buttonVariants } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { toast } from 'svelte-sonner';
	// Icons
	import SearchIcon from '@lucide/svelte/icons/search';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useRoles } from '$lib/organizations/api/roles.svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	const { api, authClient } = getAuthContext();

	// Types
	import type { Role, ListInvitationsType } from '$lib/auth/types';

	// Props
	let {
		initialData
	}: {
		initialData?: {
			invitationList?: ListInvitationsType;
			role?: Role;
		};
	} = $props();

	// Auth
	const auth = useAuth();
	const roles = useRoles({}, () => ({
		initialData: initialData?.role
	}));
	const isOwnerOrAdmin = $derived(roles.hasOwnerOrAdminRole);

	// Queries
	const invitationListResponse = useQuery(
		api.organizations.invitations.queries.listInvitations,
		() => (auth.isAuthenticated ? {} : 'skip'),
		() => ({
			initialData: initialData?.invitationList
		})
	);
	const invitationList = $derived(invitationListResponse?.data);

	// State
	let selectedInvitationId: string | null = $state(null);
	let searchQuery: string = $state('');
	let isRevokeDialogOpen: boolean = $state(false);
	let isRevoking: boolean = $state(false);

	// Selected invitation for dialog text
	const selectedInvitation = $derived.by(
		() => invitationList?.find((i) => i.id === selectedInvitationId) ?? null
	);

	/**
	 * Filter invitations based on search query and only show pending invitations
	 */
	const filteredInvitations = $derived.by(() => {
		if (!invitationList) return [];

		return invitationList
			.filter((invitation) => {
				// Only show pending invitations
				if (invitation.status !== 'pending') return false;
				if (!searchQuery) return true;
				return invitation.email.toLowerCase().includes(searchQuery.toLowerCase());
			})
			.sort((a, b) => {
				// Sort by role (owner first, then admin, then team leader, then member)
				const roleOrder: Record<Role, number> = {
					owner: 0,
					admin: 1,
					team_leader: 2,
					member: 3
				};

				// Primary sort by role
				const roleDiff = roleOrder[a.role as Role] - roleOrder[b.role as Role];
				if (roleDiff !== 0) return roleDiff;

				// Secondary sort by email
				return a.email.localeCompare(b.email);
			});
	});

	/**
	 * Handles revoking an invitation
	 */
	async function handleRevokeInvitation(): Promise<void> {
		if (!selectedInvitationId) return;

		isRevoking = true;
		try {
			const { error } = await authClient.organization.cancelInvitation({
				invitationId: selectedInvitationId
			});

			if (error?.message) {
				toast.error(error.message);
				return;
			}
			toast.success('Invitation revoked successfully');
			isRevokeDialogOpen = false;
			selectedInvitationId = null;
		} catch {
			toast.error('Failed to revoke the invitation');
		} finally {
			isRevoking = false;
		}
	}

	/**
	 * Handle search input change
	 */
	function handleSearchChange(e: Event): void {
		const target = e.target as HTMLInputElement;
		searchQuery = target.value;
	}
</script>

{#if !invitationList}
	<div>Loading invitations...</div>
{:else if filteredInvitations.length === 0 && !searchQuery}
	<div class="text-muted-foreground p-8 text-center">
		<p>No pending invitations.</p>
	</div>
{:else}
	<div class="flex h-full flex-col">
		<!-- Search Section - Fixed at top -->
		<div class="flex flex-shrink-0 items-center gap-3 py-4">
			<div class="relative flex-1">
				<div class="pointer-events-none absolute inset-y-0 flex items-center">
					<SearchIcon class="text-muted-foreground size-4" />
				</div>
				<Input
					type="text"
					class="!border-0 !border-transparent pl-6 text-sm"
					placeholder="Search invitations..."
					value={searchQuery}
					onchange={handleSearchChange}
				/>
			</div>
		</div>

		<!-- Table Section - Scrollable area -->
		<div class="min-h-0 flex-1">
			{#if filteredInvitations.length === 0 && searchQuery}
				<div class="text-muted-foreground p-8 text-center">
					<p>No invitations match your search.</p>
				</div>
			{:else}
				<div>
					<!-- Table container with controlled height and scroll -->
					<div
						class="max-h-[calc(90vh-12rem)] overflow-y-auto pb-12 sm:max-h-[calc(80vh-12rem)] md:max-h-[calc(70vh-12rem)]"
					>
						<Table.Root class="table-fixed">
							<Table.Header class="sticky top-0 z-20">
								<Table.Row>
									<Table.Head class="w-64 truncate">User</Table.Head>
									<Table.Head class="w-32">Expires</Table.Head>
									<Table.Head class="hidden w-32 sm:table-cell">Role</Table.Head>
									{#if isOwnerOrAdmin}
										<Table.Head class="w-20 text-right"></Table.Head>
									{/if}
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each filteredInvitations as invitation (invitation.id)}
									<Table.Row>
										<!-- User -->
										<Table.Cell class="w-64 max-w-64 truncate">
											<span class="truncate font-medium">{invitation.email}</span>
										</Table.Cell>
										<!-- Expires -->
										<Table.Cell class="w-64 max-w-64 truncate">
											<span class="truncate font-medium">
												{new Date(invitation.expiresAt).toLocaleDateString()}
											</span>
										</Table.Cell>
										<!-- Role -->
										<Table.Cell class="hidden w-32 sm:table-cell">
											{#if invitation.role === 'owner'}
												<Badge variant="default">Owner</Badge>
											{:else if invitation.role === 'admin'}
												<Badge variant="outline">Admin</Badge>
											{:else}
												<Badge variant="secondary">Member</Badge>
											{/if}
										</Table.Cell>
										<!-- Actions -->
										<Table.Cell class="w-20">
											<div class="flex justify-end">
												{#if isOwnerOrAdmin}
													<Button
														type="button"
														variant="secondary"
														size="sm"
														onclick={() => {
															selectedInvitationId = invitation.id;
															isRevokeDialogOpen = true;
														}}
													>
														Revoke
													</Button>
												{/if}
											</div>
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<Dialog.Root bind:open={isRevokeDialogOpen}>
		<Dialog.Content class="md:max-w-108">
			<Dialog.Header class="flex-shrink-0">
				<Dialog.Title>Revoke invitation</Dialog.Title>
			</Dialog.Header>

			<article class="flex-shrink-0 px-6">
				<p class="opacity-60">
					Are you sure you want to revoke the invitation
					{#if selectedInvitation}
						sent to {selectedInvitation.email}?
					{:else}
						?
					{/if}
				</p>
			</article>

			<Dialog.Footer class="w-full flex-shrink-0 p-6">
				<Dialog.Close class={buttonVariants({ variant: 'outline' })} disabled={isRevoking}>
					Cancel
				</Dialog.Close>

				<Button variant="destructive" onclick={handleRevokeInvitation} loading={isRevoking}>
					{#if isRevoking}
						Revoking...
					{:else}
						Confirm
					{/if}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
