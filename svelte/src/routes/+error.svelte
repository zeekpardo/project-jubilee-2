<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Alert from '$lib/primitives/ui/alert';
	import { Button } from '$lib/primitives/ui/button';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import SearchXIcon from '@lucide/svelte/icons/search-x';
	import * as m from '$lib/i18n/messages';

	// The app's only error boundary, so it renders in two very different places:
	// standing alone when a root load fails, and inside the app shell when a
	// nested one does. Hence the self-contained centring rather than leaning on
	// PageContainer, which is not guaranteed to be around it.
	const isNotFound = $derived(page.status === 404);

	// SvelteKit deliberately replaces the message of an UNEXPECTED server error
	// with this, so the real cause never reaches the browser. Repeating it back
	// as "Details:" tells the user nothing and reads like a placeholder bug —
	// only a thrown `error(status, message)` carries something worth showing.
	const GENERIC_MESSAGE = 'Internal Error';
	const detail = $derived(
		page.error?.message && page.error.message !== GENERIC_MESSAGE ? page.error.message : null
	);

	// A failed load is the common case and is usually transient — a Convex blip,
	// a dropped connection. `invalidateAll` re-runs the loads in place, which is
	// the closest thing SvelteKit has to an error-boundary reset; a full reload
	// would also discard client state for no extra benefit.
	let isRetrying = $state(false);

	async function retry(): Promise<void> {
		if (isRetrying) return;
		isRetrying = true;
		try {
			await invalidateAll();
		} finally {
			isRetrying = false;
		}
	}
</script>

<div class="flex min-h-[60vh] flex-1 items-center justify-center p-4 md:px-6">
	<div class="flex w-full max-w-md flex-col gap-4">
		<Alert.Root variant={isNotFound ? 'default' : 'destructive'}>
			{#if isNotFound}
				<SearchXIcon class="size-4" aria-hidden="true" />
			{:else}
				<AlertCircleIcon class="size-4" aria-hidden="true" />
			{/if}
			<Alert.Title>
				{isNotFound ? m.error_notFoundTitle() : m.error_title()}
			</Alert.Title>
			<Alert.Description class="flex flex-col gap-1">
				<p>{isNotFound ? m.error_notFoundBody() : m.error_body()}</p>
				<!-- A real message can carry framework internals, so it is a secondary
				     detail rather than the headline. -->
				{#if !isNotFound && detail}
					<p class="text-xs opacity-80">{m.error_details({ message: detail })}</p>
				{/if}
			</Alert.Description>
		</Alert.Root>

		<div class="flex flex-wrap items-center gap-2">
			{#if !isNotFound}
				<Button onclick={retry} loading={isRetrying}>{m.error_retry()}</Button>
			{/if}
			<Button variant="outline" href={resolve('/app')}>{m.error_backHome()}</Button>
		</div>
	</div>
</div>
