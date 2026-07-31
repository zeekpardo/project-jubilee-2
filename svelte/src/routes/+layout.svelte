<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	import { untrack } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth/api/auth-client';
	import { api } from '$convex/_generated/api';
	import { AUTH_CONSTANTS } from '$convex/auth.constants';

	import { Toaster } from '$lib/primitives/ui/sonner';
	import AuthProvider from '$lib/auth/ui/AuthProvider.svelte';
	import UserProfileHost from '$lib/users/ui/UserProfileHost.svelte';
	import OrganizationProfileHost from '$lib/organizations/ui/OrganizationProfileHost.svelte';
	import { themeState } from '$lib/theme';

	let { children, data } = $props();

	createSvelteAuthClient({ authClient, getServerState: () => data.authState });

	untrack(() => themeState.init(data.theme, data.mode));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<ModeWatcher defaultMode={data.mode} defaultTheme={data.theme} />
<Toaster position="top-center" />
<AuthProvider {api} {authClient} authConstants={AUTH_CONSTANTS}>
	<!--
		The shell lives in `/app`: the sidebar owns the full height and the header
		sits inside the content column, so the root layout only provides context.
	-->
	<div class="flex min-h-[100dvh] flex-col">
		{@render children()}
	</div>

	<UserProfileHost initialData={data.initialData} />

	{#if AUTH_CONSTANTS.organizations}
		<OrganizationProfileHost initialData={data.initialData} />
	{/if}
</AuthProvider>
