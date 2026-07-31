<script lang="ts">
	// SvelteKit
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	// Primitives
	import { toast } from 'svelte-sonner';
	import * as Password from '$lib/primitives/ui/password';
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { Label } from '$lib/primitives/ui/label';
	import { Spinner } from '$lib/primitives/ui/spinner';

	// Icons
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';

	// API
	import { authClient } from '$lib/auth/api/auth-client';
	import { onMount } from 'svelte';

	type ResetState = 'loading' | 'valid-token' | 'invalid-token' | 'error';

	// State
	let resetState: ResetState = $state('loading');
	let password: string = $state('');
	let confirmPassword: string = $state('');
	let isSubmitting: boolean = $state(false);
	let token: string | null = $state(null);

	// Extract token from URL parameters and validate
	onMount(() => {
		const tokenParam = page.url.searchParams.get('token');
		const errorParam = page.url.searchParams.get('error');

		if (errorParam === 'INVALID_TOKEN') {
			resetState = 'invalid-token';
		} else if (tokenParam) {
			token = tokenParam;
			resetState = 'valid-token';
		} else {
			resetState = 'invalid-token';
		}
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();

		const form = event.currentTarget as HTMLFormElement;
		form.dataset.submitted = 'true';
		if (!form.checkValidity()) {
			form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
			return;
		}

		if (password !== confirmPassword) {
			toast.error('Passwords do not match');
			return;
		}

		if (!token) {
			toast.error('Invalid reset token');
			return;
		}

		isSubmitting = true;

		try {
			const { error } = await authClient.resetPassword({
				newPassword: password,
				token
			});

			if (error) {
				throw new Error(error.message || 'Failed to reset password');
			}
			toast.success('Password reset successfully!');

			// Redirect immediately to sign in
			goto(resolve('/signin'));
		} catch (error) {
			console.error('Reset password error:', error);
			const errorMessage =
				error instanceof Error ? error.message : 'Failed to reset password. Please try again.';

			if (errorMessage.includes('expired') || errorMessage.includes('invalid')) {
				resetState = 'invalid-token';
				toast.error('Reset link has expired or is invalid. Please request a new one.');
			} else {
				resetState = 'error';
				toast.error(errorMessage);
			}
		} finally {
			isSubmitting = false;
		}
	}

	function handleTryAgain() {
		resetState = 'valid-token';
		password = '';
		confirmPassword = '';
	}
</script>

<div class="flex min-h-svh w-full items-center justify-center p-4">
	<Card.Root class="w-full max-w-md">
		<Card.Header>
			<Card.Title class="text-lg">
				{resetState === 'valid-token' ? 'Reset your password' : 'Invalid or Expired Link'}
			</Card.Title>
			{#if resetState === 'valid-token'}
				<Card.Description>Enter your new password below.</Card.Description>
			{/if}
		</Card.Header>

		<Card.Content>
			{#if resetState === 'loading'}
				<div class="flex flex-col items-center gap-4">
					<Spinner size="lg" />
					<p class="text-muted-foreground text-sm">Verifying reset link...</p>
				</div>
			{:else if resetState === 'invalid-token'}
				<div class="flex flex-col gap-6">
					<div>
						<p class="text-muted-foreground text-sm">
							This password reset link is invalid or has expired.
							<br />
							Please request a new password reset link.
						</p>
					</div>
					<Button href={resolve('/signin')} class="w-full">Back to Sign In</Button>
				</div>
			{:else if resetState === 'valid-token'}
				<form onsubmit={handleSubmit} novalidate class="flex w-full flex-col gap-8">
					<!-- Inputs -->
					<div class="flex flex-col gap-5">
						<div class="flex flex-col gap-2">
							<Label for="new-password">New Password</Label>
							<Password.Root>
								<Password.Input
									id="new-password"
									bind:value={password}
									placeholder="Enter your new password"
									required
									disabled={isSubmitting}
								>
									<Password.ToggleVisibility />
								</Password.Input>
								<Password.Error />
								<Password.Strength />
							</Password.Root>
						</div>

						<div class="flex flex-col gap-2">
							<Label for="confirm-password">Confirm New Password</Label>
							<Password.Root minScore={0}>
								<Password.Input
									id="confirm-password"
									bind:value={confirmPassword}
									placeholder="Enter your new password"
									required
									disabled={isSubmitting}
								>
									<Password.ToggleVisibility />
								</Password.Input>
							</Password.Root>
						</div>
					</div>

					<div class="flex flex-col gap-2">
						<Button type="submit" class="w-full" disabled={isSubmitting} loading={isSubmitting}>
							{isSubmitting ? 'Resetting password...' : 'Reset Password'}
						</Button>

						<Button href={resolve('/signin')} variant="ghost" class="w-full">Back to Sign In</Button
						>
					</div>
				</form>
			{:else}
				<!-- error state -->
				<div class="flex flex-col items-center gap-6">
					<div class="bg-destructive/10 text-destructive rounded-full p-3">
						<AlertTriangleIcon class="size-6" />
					</div>
					<div class="text-center">
						<h2 class="text-foreground text-xl font-semibold">Something went wrong</h2>
						<p class="text-muted-foreground mt-2 text-sm">
							There was an error resetting your password.
							<br />
							Please try again or request a new reset link.
						</p>
					</div>
					<div class="flex w-full gap-2">
						<Button href={resolve('/signin')} variant="secondary" class="flex-1"
							>Back to Sign In</Button
						>
						<Button type="button" class="flex-1" onclick={handleTryAgain}>Try Again</Button>
					</div>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
