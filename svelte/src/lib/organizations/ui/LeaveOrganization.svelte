<script lang="ts">
	// Svelte
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	/** UI */
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import { toast } from 'svelte-sonner';
	import * as Select from '$lib/primitives/ui/select';
	import { createListCollection } from '@ark-ui/svelte/select';
	import * as Card from '$lib/primitives/ui/card';
	import { Button, buttonVariants } from '$lib/primitives/ui/button';
	import { Label } from '$lib/primitives/ui/label';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useRoles } from '$lib/organizations/api/roles.svelte';
	import { ConvexError } from 'convex/values';
	import { getAuthContext } from '$lib/auth/context.svelte';
	const { api } = getAuthContext();
	const client = useConvexClient();

	// Types
	import type { GetActiveOrganizationType, GetActiveUserType, Role } from '$lib/auth/types';

	// Props
	let {
		initialData,
		variant = 'panel'
	}: {
		initialData?: {
			activeUser?: GetActiveUserType;
			activeOrganization?: GetActiveOrganizationType;
			role?: Role;
		};
		/**
		 * `panel` renders the full destructive settings-card treatment (General settings tab).
		 * `inline` renders just the trigger button for compact contexts (e.g. the organization switcher).
		 */
		variant?: 'panel' | 'inline';
	} = $props();

	// Auth
	const auth = useAuth();
	const roles = useRoles({}, () => ({
		initialData: initialData?.role
	}));
	const isOwner = $derived(roles.hasOwnerRole);

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
	const activeUser = $derived(activeUserResponse?.data);
	const activeOrganization = $derived(activeOrganizationResponse?.data);
	const members = $derived(activeOrganization?.members);

	// State
	let isOpen: boolean = $state(false);
	let isLeaving: boolean = $state(false);

	// Organization members excluding current user for successor selection
	const organizationMembers = $derived(
		members?.filter(
			(member) =>
				// Don't include the current user
				member.userId !== activeUser?._id
		) || []
	);

	// Successor select
	let selectedSuccessor = $state<string[]>([]);
	const successorCollection = $derived(
		createListCollection({
			items: organizationMembers.map((member) => ({
				label: `${member.user.name} (${member.user.email})`,
				value: member.id
			}))
		})
	);

	/**
	 * Validates form input before submission
	 */
	function validateForm(): boolean {
		if (isOwner && selectedSuccessor.length === 0) {
			toast.error('As the organization owner, you must select a successor before leaving.');
			return false;
		}
		return true;
	}

	/**
	 * Handles the leave organization action
	 */
	async function handleLeaveOrganization(): Promise<void> {
		if (!validateForm()) return;

		if (!activeOrganization?.id) {
			toast.error('No active organization found.');
			return;
		}

		isLeaving = true;

		try {
			await client.mutation(api.organizations.members.mutations.leaveOrganization, {
				// Only send successorMemberId if the user is an owner and a successor is selected
				...(isOwner && selectedSuccessor.length > 0
					? { successorMemberId: selectedSuccessor[0] }
					: {})
			});

			isOpen = false;

			toast.success('Successfully left the organization.');
			// Navigate to home page after leaving
			goto(resolve('/'));
		} catch (err) {
			if (err instanceof ConvexError) {
				toast.error(err.data);
			} else {
				toast.error(
					err instanceof Error ? err.message : 'Failed to leave organization. Please try again.'
				);
			}
			console.error(err);
		} finally {
			isLeaving = false;
		}
	}
</script>

{#snippet leaveDialog()}
	<Dialog.Root bind:open={isOpen}>
		<Dialog.Trigger
			class={variant === 'panel'
				? buttonVariants({ variant: 'destructive' })
				: buttonVariants({ variant: 'ghost', size: 'sm' }) + ' text-destructive w-fit'}
		>
			Leave organization
		</Dialog.Trigger>

		<Dialog.Content class="md:max-w-108">
			<Dialog.Header>
				<Dialog.Title>Leave organization</Dialog.Title>
			</Dialog.Header>

			<Dialog.Description class="flex flex-col gap-2">
				<span> If you leave organization you'll lose access to all projects and resources. </span>
				{#if isOwner}
					<span class="my-2">As the owner, you must assign a new owner before leaving.</span>
				{/if}
			</Dialog.Description>

			{#if isOwner}
				<div class="w-full space-y-2">
					<Label for="successor">New owner:</Label>
					<Select.Root collection={successorCollection} bind:value={selectedSuccessor}>
						<Select.Trigger class="w-full" placeholder="Choose a successor" />
						<Select.Content>
							{#each successorCollection.items as item (item.value)}
								<Select.Item {item}>
									<Select.ItemText>{item.label}</Select.ItemText>
									<Select.ItemIndicator>✓</Select.ItemIndicator>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}

			<Dialog.Footer>
				<Dialog.Close class={buttonVariants({ variant: 'outline' })} disabled={isLeaving}>
					Cancel
				</Dialog.Close>
				<Button
					variant="destructive"
					onclick={handleLeaveOrganization}
					disabled={isOwner && !selectedSuccessor}
					loading={isLeaving}
				>
					{#if isLeaving}
						Leaving...
					{:else}
						Confirm
					{/if}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/snippet}

{#if activeOrganization && members && members.length > 1}
	{#if variant === 'panel'}
		<Card.Root class="border-destructive/50 w-full">
			<Card.Header>
				<Card.Title>Leave organization</Card.Title>
				<Card.Description>
					You'll lose access to all projects and resources in this organization.
				</Card.Description>
			</Card.Header>
			<Card.Footer>
				{@render leaveDialog()}
			</Card.Footer>
		</Card.Root>
	{:else}
		{@render leaveDialog()}
	{/if}
{/if}
