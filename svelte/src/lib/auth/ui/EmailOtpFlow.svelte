<script lang="ts">
	// Svelte
	import { toast } from 'svelte-sonner';

	// Primitives
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';

	// API
	import { getAuthContext } from '$lib/auth/context.svelte';
	const { authClient } = getAuthContext();

	interface EmailOtpFlowProps {
		email: string;
		emailExists: boolean;
		onSuccess: () => void;
		onBack: () => void;
		submitting: boolean;
		onSubmittingChange: (submitting: boolean) => void;
	}

	let { email, emailExists, onSuccess, onBack, submitting, onSubmittingChange }: EmailOtpFlowProps =
		$props();

	let otp = $state('');
	let name = $state('');
	const mode: 'login' | 'register' = $derived(emailExists ? 'login' : 'register');

	/**
	 * Handles OTP verification
	 */
	async function handleVerifyOtp(): Promise<void> {
		onSubmittingChange(true);

		try {
			if (mode === 'login') {
				await authClient.signIn.emailOtp(
					{ email, otp },
					{
						onSuccess,
						onError: (ctx) => {
							console.error('OTP verification error:', ctx.error);
							toast.error(ctx.error.message || 'Invalid verification code. Please try again.');
							onSubmittingChange(false);
						}
					}
				);
				return;
			}

			await authClient.signIn.emailOtp(
				{ email, otp },
				{
					onError: (ctx) => {
						console.error('OTP verification error:', ctx.error);
						toast.error(ctx.error.message || 'Invalid verification code. Please try again.');
						onSubmittingChange(false);
					}
				}
			);

			await authClient.updateUser(
				{ name },
				{
					onSuccess,
					onError: (ctx) => {
						console.error('Profile update error:', ctx.error);
						toast.error(ctx.error.message || 'Signed in, but failed to save your name.');
						onSubmittingChange(false);
					}
				}
			);
		} catch (error) {
			console.error('OTP sign in error:', error);
			let errorMessage = 'Invalid verification code. Please try again.';

			if (error instanceof Error) {
				if (error.message.includes('Invalid OTP')) {
					errorMessage = 'Invalid verification code. Please try again.';
				} else if (error.message.includes('expired')) {
					errorMessage = 'Verification code has expired. Please request a new one.';
				} else {
					errorMessage = error.message;
				}
			}

			toast.error(errorMessage);
			onSubmittingChange(false);
		}
	}

	/**
	 * Handles form submission
	 */
	function handleSubmit(event: Event): void {
		event.preventDefault();
		handleVerifyOtp();
	}
</script>

<form onsubmit={handleSubmit} autocomplete="off" class="flex flex-col gap-8">
	<!-- Inputs -->
	<div class="flex flex-col gap-5">
		<div class="flex flex-col gap-2">
			<Label for="email">Email</Label>
			<Input id="email" type="email" value={email} disabled />
		</div>

		{#if mode === 'register'}
			<div class="flex flex-col gap-2">
				<Label for="name">Full Name</Label>
				<Input
					id="name"
					type="text"
					bind:value={name}
					placeholder="Enter your full name"
					autocomplete="name"
					required
					disabled={submitting}
				/>
			</div>
		{/if}

		<div class="flex flex-col gap-2">
			<Label for="otp">Verification Code</Label>
			<Input
				id="otp"
				type="text"
				bind:value={otp}
				placeholder="Enter verification code"
				pattern="[0-9]*"
				inputmode="numeric"
				maxlength={6}
				autocomplete="one-time-code"
				required
				disabled={submitting}
			/>
		</div>
	</div>

	<!-- Actions -->
	<div class="flex flex-col gap-2">
		<Button
			type="submit"
			class="w-full"
			disabled={submitting || !otp.trim() || (mode === 'register' && !name.trim())}
			loading={submitting}
		>
			{#if submitting}
				{mode === 'register' ? 'Creating account...' : 'Verifying...'}
			{:else}
				{mode === 'register' ? 'Create Account' : 'Verify Code'}
			{/if}
		</Button>

		<Button type="button" variant="ghost" onclick={onBack} disabled={submitting}>
			Use a different email
		</Button>
	</div>
</form>
