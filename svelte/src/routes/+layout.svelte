<script lang="ts">
	import { resolve } from '$app/paths';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	import { untrack } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth/api/auth-client';
	import { api } from '$convex/_generated/api';
	import { AUTH_CONSTANTS } from '$convex/auth.constants';

	import { Toaster } from '$lib/primitives/ui/sonner';
	import OrganizationSwitcher from '$lib/organizations/ui/OrganizationSwitcher.svelte';
	import UserButton from '$lib/users/ui/UserButton.svelte';
	import AuthProvider from '$lib/auth/ui/AuthProvider.svelte';
	import UserProfileHost from '$lib/users/ui/UserProfileHost.svelte';
	import OrganizationProfileHost from '$lib/organizations/ui/OrganizationProfileHost.svelte';
	import { ModeToggle, ThemeSelector, themeState } from '$lib/theme';

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
	<div class="flex min-h-[100dvh] flex-col">
		<header
			class="bg-background/85 sticky top-0 z-30 flex h-16 min-w-0 items-center justify-between gap-2 border-b px-3 backdrop-blur sm:gap-5 sm:px-4"
		>
			<a
				href={resolve('/')}
				class="text-foreground mr-auto min-w-0 truncate text-lg font-bold tracking-tight sm:text-xl"
			>
				{data.initialData?.activeOrganization?.name ?? 'Admin'}
			</a>
			<ThemeSelector class="hidden sm:block" />
			<ModeToggle />
			{#if AUTH_CONSTANTS.organizations}
				<OrganizationSwitcher initialData={data.initialData} />
			{/if}
			<UserButton initialData={data.initialData} />
		</header>
		<main class="flex flex-1 flex-col">
			{@render children()}
		</main>
	</div>

	<UserProfileHost initialData={data.initialData} />

	{#if AUTH_CONSTANTS.organizations}
		<OrganizationProfileHost initialData={data.initialData} />
	{/if}
</AuthProvider>
