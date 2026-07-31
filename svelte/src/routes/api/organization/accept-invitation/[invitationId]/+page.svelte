<script lang="ts">
	// Svelte
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	// Auth
	import { authClient } from '$lib/auth/api/auth-client';

	// Icons
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';

	// UI
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';

	// Get invitationId from page params
	let invitationId = $derived(page.params.invitationId);

	// Reactive state using runes
	let isLoading = $state(true);
	let accepted = $state(false);
	let error = $state<string | null>(null);

	// Function to accept invitation
	async function acceptInvitation(id: string) {
		try {
			const { data, error } = await authClient.organization.acceptInvitation({
				invitationId: id
			});
			if (error) {
				throw new Error(error.message || 'An unknown error occurred');
			}

			const orgId = data?.invitation?.organizationId;
			if (!orgId) {
				throw new Error('Invalid invitation');
			}

			accepted = true;
			goto(resolve('/'));
		} catch (err) {
			error = err instanceof Error ? err.message : 'An unknown error occurred';
		} finally {
			isLoading = false;
		}
	}

	// Effect to handle invitation acceptance
	onMount(() => {
		if (invitationId) {
			acceptInvitation(invitationId);
		} else {
			isLoading = false;
		}
	});
</script>

<div class="flex min-h-dvh items-center justify-center p-6">
	<Card.Root class="w-full max-w-md">
		<Card.Content class="flex flex-col items-center gap-4 text-center">
			{#if isLoading}
				<Loader2Icon class="text-muted-foreground size-10 animate-spin" />
				<h1 class="text-lg leading-none font-semibold">Accepting invitation…</h1>
				<p class="text-muted-foreground text-sm">Please wait a moment.</p>
			{:else if accepted}
				<CheckCircle2Icon class="text-primary size-10" />
				<h1 class="text-lg leading-none font-semibold">Invitation accepted</h1>
				<p class="text-muted-foreground text-sm">Redirecting to dashboard…</p>
			{:else if error}
				<TriangleAlertIcon class="text-destructive size-10" />
				<h1 class="text-lg leading-none font-semibold">Couldn't accept invitation</h1>
				<p class="text-muted-foreground text-sm">{error}</p>
				<Button variant="outline" href={resolve('/')}>Go to Home</Button>
			{:else if !invitationId}
				<TriangleAlertIcon class="text-destructive size-10" />
				<h1 class="text-lg leading-none font-semibold">Invalid invite link</h1>
				<p class="text-muted-foreground text-sm">Please use a valid invite link.</p>
				<Button variant="outline" href={resolve('/')}>Go to Home</Button>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
