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

		The account and organization profile dialogs live in `/app` for the same
		reason, and for a stronger one. This layout wraps every route group, so
		mounting them here put the signed-in person's name, email, linked
		accounts, API keys and "Delete account" — plus the organization's slug and
		settings — into the DOM of the public donor site and of a donor's
		`/{orgSlug}/me` pages. A donor's identity on this site is their `contacts`
		row; the Better Auth account behind it is a credentials record they should
		never be shown, let alone offered controls for.
	-->
	<div class="flex min-h-[100dvh] flex-col">
		{@render children()}
	</div>
</AuthProvider>
