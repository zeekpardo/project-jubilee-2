<script lang="ts">
	import { onMount } from 'svelte';
	import { authClient } from '$lib/auth/api/auth-client';
	import { page } from '$app/state';
	import { AUTH_CONSTANTS } from '$convex/auth.constants';

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import * as Alert from '$lib/primitives/ui/alert';
	import { Button } from '$lib/primitives/ui/button';

	let userCode: string = $state('');
	let verifyLoading = $state(true);
	let verifyError: string | null = $state(null);
	let verified = $state(false);

	let actionLoading: 'approve' | 'deny' | null = $state(null);
	let actionError: string | null = $state(null);
	let actionDone: 'approved' | 'denied' | null = $state(null);

	onMount(async () => {
		if (!AUTH_CONSTANTS.deviceAuthorization) {
			return;
		}

		userCode = page.url.searchParams.get('user_code') ?? '';
		if (!userCode) {
			verifyError = 'Missing code';
			return;
		}

		verifyLoading = true;

		const response = await authClient.device({
			query: { user_code: userCode }
		});

		if (response.error) {
			verifyError = response.error.error_description;
		} else {
			verified = true;
		}

		verifyLoading = false;
	});

	async function handleApprove() {
		actionError = null;
		actionLoading = 'approve';
		const { error } = await authClient.device.approve({ userCode });
		if (error) {
			actionError = error.error_description;
			return;
		} else {
			actionDone = 'approved';
		}
		actionLoading = null;
	}

	async function handleDeny() {
		actionError = null;
		actionLoading = 'deny';
		const { error } = await authClient.device.deny({ userCode });
		if (error) {
			actionError = error.error_description;
			return;
		} else {
			actionDone = 'denied';
		}
		actionLoading = null;
	}
</script>

<div class="flex min-h-svh w-full items-center justify-center p-4">
	<Card.Root class="w-full max-w-lg">
		<Card.Header>
			<Card.Title class="text-lg">Authorize Device</Card.Title>
		</Card.Header>

		<Card.Content>
			{#if AUTH_CONSTANTS.deviceAuthorization}
				{#if verifyLoading}
					<p class="text-muted-foreground">Verifying your code…</p>
				{:else if verifyError}
					<Alert.Root variant="destructive" class="mb-4">
						<Alert.Description>{verifyError}</Alert.Description>
					</Alert.Root>
					<p class="text-muted-foreground text-sm">
						Check that you opened this page from the device and that the URL contains a valid code.
					</p>
				{:else if actionDone === 'approved'}
					<Alert.Root variant="success" class="mb-4">
						<Alert.Description>Success! You approved the request.</Alert.Description>
					</Alert.Root>
					<p class="text-muted-foreground">
						You can return to the device now. The device should connect automatically.
					</p>
				{:else if actionDone === 'denied'}
					<Alert.Root variant="warning" class="mb-4">
						<Alert.Description>Request denied.</Alert.Description>
					</Alert.Root>
					<p class="text-muted-foreground">You can close this window.</p>
				{:else if verified}
					<p class="text-muted-foreground mb-6">Do you want to sign in on your device?</p>

					{#if actionError}
						<Alert.Root variant="destructive" class="mb-4">
							<Alert.Description>{actionError}</Alert.Description>
						</Alert.Root>
					{/if}

					<div class="flex justify-end gap-3">
						<Button
							type="button"
							variant="secondary"
							onclick={handleDeny}
							disabled={!!actionLoading}
							loading={actionLoading === 'deny'}
						>
							{actionLoading === 'deny' ? 'Denying…' : 'Deny'}
						</Button>
						<Button
							type="button"
							onclick={handleApprove}
							disabled={!!actionLoading}
							loading={actionLoading === 'approve'}
						>
							{actionLoading === 'approve' ? 'Approving…' : 'Approve'}
						</Button>
					</div>
				{/if}
			{:else}
				<p class="text-muted-foreground">Device authorization is not enabled.</p>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
