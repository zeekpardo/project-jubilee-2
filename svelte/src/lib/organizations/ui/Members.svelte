<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Drawer from '$lib/primitives/ui/drawer';
	import * as Avatar from '$lib/primitives/ui/avatar';
	import * as Select from '$lib/primitives/ui/select';
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button, buttonVariants } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Portal } from '@ark-ui/svelte/portal';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { toast } from 'svelte-sonner';
	// Icons
	import SearchIcon from '@lucide/svelte/icons/search';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import PencilIcon from '@lucide/svelte/icons/pencil';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useRoles } from '$lib/organizations/api/roles.svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	const { api, authClient } = getAuthContext();

	// Types
	import type { Member, Role, GetActiveOrganizationType, GetActiveUserType } from '$lib/auth/types';

	// Props
	let {
		initialData
	}: {
		initialData?: {
			activeUser?: GetActiveUserType;
			activeOrganization?: GetActiveOrganizationType;
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
	const activeUserResponse = useQuery(
		api.users.queries.getActiveUser,
		() => (auth.isAuthenticated ? {} : 'skip'),
		() => ({
			initialData: initialData?.activeUser
		})
	);
	const activeOrganizationResponse = useQuery(
		api.organizations.queries.getActiveOrganization,
		() => (auth.isAuthenticated ? {} : 'skip'),
		() => ({
			initialData: initialData?.activeOrganization
		})
	);
	// Derived data
	const activeUser = $derived(activeUserResponse?.data);
	const activeOrganization = $derived(activeOrganizationResponse?.data);
	const members = $derived(activeOrganization?.members);

	// State
	let selectedUserId: string | null = $state(null);
	let searchQuery: string = $state('');
	let isDialogOpen: boolean = $state(false);
	let isDrawerOpen: boolean = $state(false);
	let selectedMember: Member | null = $state(null);

	const rolesCollection = createListCollection({
		items: [
			{ label: 'Admin', value: 'admin' },
			{ label: 'Member', value: 'member' }
		]
	});

	/**
	 * Filter and sort members based on search query and role
	 */
	const filteredMembers = $derived.by(() => {
		if (!members) return [];

		return members
			.filter((member) => {
				if (!searchQuery) return true;

				const memberName = member.user.name;
				const memberEmail = member.user.email;
				const query = searchQuery.toLowerCase();

				return (
					memberName.toLowerCase().includes(query) || memberEmail.toLowerCase().includes(query)
				);
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
				const roleDiff = roleOrder[a.role] - roleOrder[b.role];
				if (roleDiff !== 0) return roleDiff;

				// Secondary sort by name
				return a.user.name.localeCompare(b.user.name);
			});
	});

	// Member currently targeted for removal (by selectedUserId)
	const memberToRemove: Member | null = $derived(
		selectedUserId ? (members?.find((m) => m.id === selectedUserId) ?? null) : null
	);

	/**
	 * Handles updating a member's role
	 */
	async function handleUpdateRole(memberId: string, newRole: Role): Promise<void> {
		if (newRole === 'owner') return; // Cannot set someone as owner this way

		const { error } = await authClient.organization.updateMemberRole({
			role: [newRole],
			memberId
		});
		if (error) {
			toast.error(error.statusText);
		} else {
			toast.success('Role updated successfully!');
			isDrawerOpen = false;
		}
	}

	/**
	 * Handles removing a member from the organization
	 */
	async function handleRemoveMember(): Promise<void> {
		if (!selectedUserId || !activeOrganization?.id) return;

		const { error } = await authClient.organization.removeMember({
			memberIdOrEmail: selectedUserId,
			organizationId: activeOrganization.id
		});
		if (error) {
			toast.error(error.statusText);
		} else {
			toast.success('Member removed successfully!');
			isDialogOpen = false;
			isDrawerOpen = false;
		}
	}

	/**
	 * Check if current user can edit a member
	 */
	function canEditMember(member: Member): boolean {
		if (!isOwnerOrAdmin) return false;
		if (member.id === activeUser?._id) return false;
		if (member.role === 'owner') return false;

		// If current user is admin, they can't edit other admins
		if (activeUser && members) {
			const currentUserMember = members.find((m) => m.id === activeUser._id);
			if (currentUserMember?.role === 'admin' && member.role === 'admin') {
				return false;
			}
		}

		return true;
	}

	/**
	 * Handle member card click
	 */
	function handleMemberCardClick(member: Member): void {
		if (canEditMember(member)) {
			selectedMember = member;
			isDrawerOpen = true;
		}
	}
</script>

{#if members}
	<div class="flex h-full flex-col">
		<!-- Search Section - Fixed at top -->
		<div class="flex flex-shrink-0 items-center gap-3 py-4">
			<div class="relative flex-1">
				<div class="pointer-events-none absolute inset-y-0 flex items-center">
					<SearchIcon class="text-muted-foreground size-4" />
				</div>
				<Input
					type="text"
					class="!border-0 border-transparent pl-6 text-sm"
					placeholder="Search members..."
					bind:value={searchQuery}
				/>
			</div>
		</div>

		<!-- Mobile Layout -->
		<div class="block min-h-0 flex-1 sm:hidden">
			<div class="flex max-h-[calc(100vh-12rem)] flex-col gap-2 overflow-y-auto pb-24">
				{#each filteredMembers as member (member.id)}
					<div
						class={`border-border flex items-center justify-between rounded-xl border-b pr-6 pb-4 ${
							canEditMember(member) ? 'hover:bg-muted cursor-pointer' : ''
						}`}
						onclick={() => handleMemberCardClick(member)}
						role="button"
						tabindex="0"
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								handleMemberCardClick(member);
							}
						}}
					>
						<div class="flex items-center space-x-3">
							<Avatar.Root class="size-10">
								<Avatar.Image src={member.user.image} alt={member.user.name} />
								<Avatar.Fallback>
									<Avatar.Marble name={member.user.name} />
								</Avatar.Fallback>
							</Avatar.Root>
							<div class="flex flex-col">
								<div class="flex items-center space-x-2">
									<span class="font-medium">{member.user.name}</span>
									{#if member.role === 'owner'}
										<Badge variant="default">Owner</Badge>
									{/if}
									{#if member.role === 'admin'}
										<Badge variant="outline">Admin</Badge>
									{/if}
								</div>
								<span class="text-muted-foreground text-sm">{member.user.email}</span>
							</div>
						</div>
						{#if canEditMember(member)}
							<PencilIcon class="size-4 opacity-60" />
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<!-- Desktop Table Layout -->
		<div class="hidden min-h-0 flex-1 sm:block">
			<div>
				<!-- Table container with controlled height and scroll -->
				<div
					class=" max-h-[calc(90vh-12rem)] overflow-hidden overflow-y-auto pb-12 sm:max-h-[calc(80vh-12rem)] md:max-h-[calc(70vh-12rem)]"
				>
					<Table.Root class="table-fixed">
						<Table.Header class="sticky top-0 z-20">
							<Table.Row>
								<Table.Head class="w-48 font-semibold">Name</Table.Head>
								<Table.Head class="hidden sm:table-cell">Email</Table.Head>
								<Table.Head class="w-32">Role</Table.Head>
								{#if isOwnerOrAdmin}
									<Table.Head class="w-16 text-right"></Table.Head>
								{/if}
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each filteredMembers as member (member.id)}
								<Table.Row>
									<!-- Member Name -->
									<Table.Cell class="w-48 max-w-48 truncate">
										<div class="flex items-center space-x-2">
											<Avatar.Root class="size-8 sm:size-5">
												<Avatar.Image src={member.user.image} alt={member.user.name} />
												<Avatar.Fallback>
													<Avatar.Marble name={member.user.name} />
												</Avatar.Fallback>
											</Avatar.Root>

											<div class="flex flex-col truncate">
												<span class="truncate text-sm">{member.user.name}</span>
												<!-- Email visible only on mobile (hidden on sm and above) -->
												<span class="text-muted-foreground truncate text-xs sm:hidden">
													{member.user.email}
												</span>
											</div>
										</div>
									</Table.Cell>
									<!-- Member Email -->
									<Table.Cell
										class="text-muted-foreground hidden h-fit w-full truncate sm:table-cell"
									>
										{member.user.email}
									</Table.Cell>
									<!-- Member Role -->
									<Table.Cell class="w-32">
										{#if isOwnerOrAdmin && member.id !== activeUser?._id && member.role !== 'owner'}
											<Select.Root
												collection={rolesCollection}
												value={[member.role]}
												onSelect={(e) => handleUpdateRole(member.id, e.value as Role)}
											>
												<Select.Trigger class="w-full text-sm" />
												<Portal>
													<Select.Content>
														{#each rolesCollection.items as item (item.value)}
															<Select.Item {item}>
																<Select.ItemText>{item.label}</Select.ItemText>
																<Select.ItemIndicator>✓</Select.ItemIndicator>
															</Select.Item>
														{/each}
													</Select.Content>
												</Portal>
											</Select.Root>
										{:else if member.role === 'owner'}
											<Badge variant="default">Owner</Badge>
										{:else if member.role === 'admin'}
											<Badge variant="outline">Admin</Badge>
										{:else}
											<Badge variant="secondary">Member</Badge>
										{/if}
									</Table.Cell>
									<!-- Member Actions -->
									<Table.Cell class="w-16">
										<div class="flex justify-end space-x-2">
											{#if isOwnerOrAdmin && member.id !== activeUser?._id && member.role !== 'owner'}
												<Button
													type="button"
													variant="ghost"
													size="icon"
													class="hover:text-destructive"
													onclick={() => {
														selectedUserId = member.id;
														isDialogOpen = true;
													}}
												>
													<TrashIcon class="size-4 opacity-70" />
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
		</div>

		<!-- Shared Remove Member Dialog -->
		<Dialog.Root bind:open={isDialogOpen}>
			<Dialog.Content class="z-[60] md:max-w-108">
				<Dialog.Header class="flex-shrink-0">
					<Dialog.Title>Remove member</Dialog.Title>
				</Dialog.Header>
				<Dialog.Description>
					Are you sure you want to remove the member {memberToRemove
						? memberToRemove.user.name
						: ''}?
				</Dialog.Description>

				<Dialog.Footer class="flex-shrink-0">
					<Dialog.Close class={buttonVariants({ variant: 'outline' })}>Cancel</Dialog.Close>
					<Button variant="destructive" onclick={handleRemoveMember}>Confirm</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>

		<!-- Mobile Drawer -->
		<Drawer.Root bind:open={isDrawerOpen}>
			<Drawer.Content>
				<Drawer.Header>
					<Drawer.Title>Edit Member</Drawer.Title>
				</Drawer.Header>
				<div class="">
					{#if selectedMember}
						<!-- Member Info -->
						<div class="flex items-center gap-3 pt-1 pb-8">
							<Avatar.Root class="size-12">
								<Avatar.Image src={selectedMember.user.image} alt={selectedMember.user.name} />
								<Avatar.Fallback>
									<Avatar.Marble name={selectedMember.user.name} />
								</Avatar.Fallback>
							</Avatar.Root>
							<div class="flex flex-col">
								<span>{selectedMember.user.name}</span>
								<p class="text-muted-foreground text-sm">{selectedMember.user.email}</p>
							</div>
						</div>

						<!-- Actions -->
						<div class="flex flex-col gap-3">
							<!-- Role Select -->
							<div class="flex flex-1 flex-col gap-2">
								<Label>Role</Label>
								<Select.Root
									collection={rolesCollection}
									value={[selectedMember.role]}
									onSelect={(e) => handleUpdateRole(selectedMember!.id, e.value as Role)}
								>
									<Select.Trigger class="w-full" placeholder="Select role" />
									<Portal>
										<Select.Content>
											{#each rolesCollection.items as item (item.value)}
												<Select.Item {item}>
													<Select.ItemText>{item.label}</Select.ItemText>
													<Select.ItemIndicator>✓</Select.ItemIndicator>
												</Select.Item>
											{/each}
										</Select.Content>
									</Portal>
								</Select.Root>
							</div>

							<!-- Remove Button -->
							<div class="flex flex-col justify-end">
								<Button
									type="button"
									variant="secondary"
									onclick={() => {
										selectedUserId = selectedMember!.id;
										isDrawerOpen = false;
										isDialogOpen = true;
									}}
								>
									<TrashIcon class="size-4" /> Remove
								</Button>
							</div>
						</div>
					{:else}
						<div class="text-muted-foreground p-4 text-center">No member selected</div>
					{/if}
				</div></Drawer.Content
			>
		</Drawer.Root>
	</div>
{:else if !activeOrganization || !activeUser}
	<div>Failed to load members</div>
{:else}
	<div>Loading members...</div>
{/if}
