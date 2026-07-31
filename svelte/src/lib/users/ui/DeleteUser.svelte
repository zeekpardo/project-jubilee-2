<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Card from '$lib/primitives/ui/card';
	import { Button, buttonVariants } from '$lib/primitives/ui/button';
	import { toast } from 'svelte-sonner';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { ConvexError } from 'convex/values';
	import { getAuthContext } from '$lib/auth/context.svelte';
	const { api, authClient } = getAuthContext();
	const client = useConvexClient();

	// Utils
	import { requestCloseUserProfile } from '$lib/users/utils/userProfile';

	// State
	let deleteDialogOpen: boolean = $state(false);
	let isDeleting: boolean = $state(false);

	/**
	 * Handle the delete confirmation action
	 */
	async function handleConfirm(): Promise<void> {
		isDeleting = true;

		// Step 1: Delete user via Convex to have transaction safety
		try {
			await client.mutation(api.users.mutations.deleteUser, {});
		} catch (error) {
			if (error instanceof ConvexError) {
				toast.error(error.data);
			} else if (error instanceof Error) {
				toast.error(error.message);
			} else {
				toast.error('Failed to delete user');
			}
			isDeleting = false;
			return;
		}

		// Step 2: Sign out via Better Auth
		const { error: signOutError } = await authClient.signOut();
		if (signOutError) {
			toast.error(signOutError.message || `${signOutError.status} ${signOutError.statusText}`);
			isDeleting = false;
			return;
		}

		// Request closing the profile dialog (handled by UserProfileHost)
		requestCloseUserProfile();

		toast.success('User deleted successfully');
		deleteDialogOpen = false;
		isDeleting = false;
	}
</script>

<Card.Root class="border-destructive/50 w-full">
	<Card.Header>
		<Card.Title>Delete account</Card.Title>
		<Card.Description>
			Permanently delete your account and all of your data. This action cannot be undone.
		</Card.Description>
	</Card.Header>
	<Card.Footer>
		<Dialog.Root bind:open={deleteDialogOpen}>
			<Dialog.Trigger class={buttonVariants({ variant: 'destructive' })}>
				Delete account
			</Dialog.Trigger>
			<Dialog.Content class="md:max-w-108">
				<Dialog.Header>
					<Dialog.Title>Delete your account</Dialog.Title>
					<Dialog.Description>
						Are you sure you want to delete your account? All of your data will be permanently
						deleted.
					</Dialog.Description>
				</Dialog.Header>
				<Dialog.Footer class="w-full">
					<Dialog.Close class={buttonVariants({ variant: 'outline' })} disabled={isDeleting}>
						Cancel
					</Dialog.Close>
					<Button variant="destructive" onclick={handleConfirm} loading={isDeleting}>
						{#if isDeleting}
							Deleting...
						{:else}
							Delete
						{/if}
					</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>
	</Card.Footer>
</Card.Root>
