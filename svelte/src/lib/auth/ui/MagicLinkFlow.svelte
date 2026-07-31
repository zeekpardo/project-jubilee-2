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

	interface MagicLinkFlowProps {
		email: string;
		onBack: () => void;
		submitting: boolean;
		onSubmittingChange: (submitting: boolean) => void;
		callbackURL?: string;
		onLinkSent?: () => void;
	}

	let {
		email,
		onBack,
		submitting,
		onSubmittingChange,
		callbackURL = '/',
		onLinkSent
	}: MagicLinkFlowProps = $props();

	let name = $state('');
	let linkSent = $state(false);

	async function handleSendMagicLink(): Promise<void> {
		onSubmittingChange(true);

		try {
			await authClient.signIn.magicLink(
				{
					email,
					name,
					callbackURL,
					newUserCallbackURL: callbackURL,
					errorCallbackURL: '/signin?error=magic-link-failed'
				},
				{
					onSuccess: () => {
						linkSent = true;
						onSubmittingChange(false);
						toast.success('Magic link sent to your email!');
						onLinkSent?.();
					},
					onError: (ctx) => {
						console.error('Magic link send error:', ctx.error);
						toast.error(ctx.error.message || 'Failed to send magic link. Please try again.');
						onSubmittingChange(false);
					}
				}
			);
		} catch (error) {
			console.error('Magic link error:', error);
			toast.error('Failed to send magic link. Please try again.');
			onSubmittingChange(false);
		}
	}

	/**
	 * Handles form submission
	 */
	function handleSubmit(event: Event): void {
		event.preventDefault();
		if (!linkSent) {
			handleSendMagicLink();
		}
	}
</script>

<form onsubmit={handleSubmit} autocomplete="off" class="flex flex-col gap-4">
	<div class="flex flex-col gap-2">
		<Label for="email">Email</Label>
		<Input id="email" type="email" value={email} disabled />
	</div>

	<div class="flex flex-col gap-2">
		<Label for="name">Full Name</Label>
		<Input
			id="name"
			type="text"
			bind:value={name}
			placeholder="Enter your full name"
			autocomplete="name"
			required
			disabled={submitting || linkSent}
		/>
	</div>

	<Button type="submit" class="w-full" disabled={submitting || !name.trim()} loading={submitting}>
		{submitting ? 'Sending...' : 'Send Magic Link'}
	</Button>

	<Button type="button" variant="ghost" onclick={onBack} disabled={submitting}>
		Use a different email
	</Button>
</form>
