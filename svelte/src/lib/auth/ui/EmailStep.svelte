<script lang="ts">
	// Svelte
	import { toast } from 'svelte-sonner';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	const { api } = getAuthContext();

	// Primitives
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';

	type AuthMethod = 'password' | 'emailOTP' | 'magicLink';

	interface EmailStepProps {
		email: string;
		onEmailChange: (email: string) => void;
		onMethodSelect: (method: AuthMethod, emailExists: boolean) => void | Promise<void>;
		submitting: boolean;
		availableMethods: AuthMethod[];
	}

	let { email, onEmailChange, onMethodSelect, submitting, availableMethods }: EmailStepProps =
		$props();

	const client = useConvexClient();
	let validatingEmail = $state(false);
	let validatingEmailMethod = $state<AuthMethod | null>(null);

	/**
	 * Gets the button text for single method scenarios
	 */
	function getSingleMethodButtonText(): string {
		if (availableMethods.length === 1) {
			switch (availableMethods[0]) {
				case 'password':
					return 'Continue';
				case 'emailOTP':
					return 'Continue';
				case 'magicLink':
					return 'Continue';
				default:
					return 'Continue';
			}
		}
		return 'Continue with Password';
	}

	/**
	 * Handles method selection and email validation
	 */
	async function handleMethodClick(method: AuthMethod): Promise<void> {
		if (!email) {
			toast.error('Please enter your email address');
			return;
		}

		// Always validate the email before proceeding to any flow
		validatingEmail = true;
		validatingEmailMethod = method;
		try {
			const data = await client.action(api.users.actions.checkEmailAvailabilityAndValidity, {
				email
			});
			if (!data.valid) {
				toast.error(data.reason || 'Please enter a valid email address.');
				return;
			}
			await onMethodSelect(method, data.exists);
		} catch (error) {
			toast.error('Failed to validate email. Please try again.');
			console.error('Email validation error:', error);
		} finally {
			validatingEmail = false;
			validatingEmailMethod = null;
		}
	}
</script>

<div class="flex flex-col gap-8">
	<div class="flex flex-col gap-2">
		<Label for="email">Email</Label>
		<Input
			id="email"
			name="email"
			type="email"
			autocomplete="email"
			value={email}
			oninput={(e) => onEmailChange(e.currentTarget.value)}
			placeholder="Enter your email"
			required
			disabled={submitting || validatingEmail}
		/>
	</div>

	{#if availableMethods.length === 1}
		<!-- Single method available -->
		<Button
			type="button"
			onclick={() => handleMethodClick(availableMethods[0])}
			class="w-full"
			disabled={submitting || validatingEmail || !email}
			loading={validatingEmail}
		>
			{#if validatingEmail}
				{validatingEmailMethod === 'password' ? 'Verifying...' : 'Sending...'}
			{:else}
				{getSingleMethodButtonText()}
			{/if}
		</Button>
	{:else}
		<!-- Multiple methods available -->
		<div class="flex flex-col gap-2">
			{#if availableMethods.includes('password')}
				<Button
					type="button"
					onclick={() => handleMethodClick('password')}
					class="w-full"
					disabled={submitting || validatingEmail || !email}
					loading={validatingEmail && validatingEmailMethod === 'password'}
				>
					{validatingEmail && validatingEmailMethod === 'password'
						? 'Verifying...'
						: 'Continue with Password'}
				</Button>
			{/if}

			{#if availableMethods.includes('emailOTP')}
				<Button
					type="button"
					variant="secondary"
					onclick={() => handleMethodClick('emailOTP')}
					class="w-full"
					disabled={submitting || validatingEmail || !email}
					loading={validatingEmail && validatingEmailMethod === 'emailOTP'}
				>
					{validatingEmail && validatingEmailMethod === 'emailOTP'
						? 'Sending...'
						: 'Continue with Email OTP'}
				</Button>
			{/if}

			{#if availableMethods.includes('magicLink')}
				<Button
					type="button"
					variant="secondary"
					onclick={() => handleMethodClick('magicLink')}
					class="w-full"
					disabled={submitting || validatingEmail || !email}
					loading={validatingEmail && validatingEmailMethod === 'magicLink'}
				>
					{validatingEmail && validatingEmailMethod === 'magicLink'
						? 'Sending...'
						: 'Continue with Magic Link'}
				</Button>
			{/if}
		</div>
	{/if}
</div>
