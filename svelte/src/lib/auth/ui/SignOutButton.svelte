<script lang="ts">
	import { cn } from '$lib/primitives/utils';
	import { Button } from '$lib/primitives/ui/button';
	import { getAuthContext } from '$lib/auth/context.svelte';
	const { authClient } = getAuthContext();
	import { invalidateAll } from '$app/navigation';

	interface SignOutButtonProps {
		onSuccess?: () => void;
		onError?: () => void;
		class?: string;
	}

	const { onSuccess, onError, class: className }: SignOutButtonProps = $props();

	async function handleSignOut() {
		const result = await authClient.signOut();
		if (result.data?.success) {
			onSuccess?.();
			// Use invalidateAll() to refresh all data and trigger middleware re-execution
			invalidateAll();
		} else {
			onError?.();
		}
	}
</script>

<Button
	type="button"
	variant="ghost"
	class={cn('h-10 justify-between gap-1 text-sm', className)}
	onclick={handleSignOut}
>
	Sign out
</Button>
