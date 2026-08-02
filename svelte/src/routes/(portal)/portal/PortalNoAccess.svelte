<script lang="ts">
	// The page someone lands on when the portal has nothing for them.
	//
	// It is not an error state. Almost everyone who sees it did what they were
	// told — they opened an invitation — and arrived here because of something
	// small and fixable, most often that the browser was already signed in as
	// somebody else. So it names the account they are actually using, says what
	// we can tell about it, and gives them the one control that resolves the
	// common case.
	//
	// Four situations, four sets of words. `getPortalSituation` decides which,
	// and only ever from the caller's own account — see its docstring for why
	// that boundary matters.
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { invalidateAll } from '$app/navigation';

	import { Button } from '$lib/primitives/ui/button';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MailQuestionIcon from '@lucide/svelte/icons/mail-question';
	import * as m from '$lib/i18n/messages';

	let {
		situation
	}: {
		situation: {
			state: 'active' | 'revoked' | 'invited' | 'unknown';
			email: string | null;
			orgName: string | null;
		} | null;
	} = $props();

	const { authClient } = getAuthContext();

	let isSigningOut = $state(false);

	// Not `state`: that is the rune's name, and shadowing it here reads as a
	// typo to everyone who comes after.
	const situationState = $derived(situation?.state ?? 'unknown');
	const email = $derived(situation?.email ?? null);
	const orgName = $derived(situation?.orgName ?? null);

	const title = $derived(
		situationState === 'revoked'
			? m.portal_noAccessRevokedTitle()
			: situationState === 'invited'
				? m.portal_noAccessInvitedTitle()
				: m.portal_noAccessTitle()
	);

	const body = $derived(
		situationState === 'revoked'
			? m.portal_noAccessRevokedBody()
			: situationState === 'invited'
				? m.portal_noAccessInvitedBody()
				: m.portal_noAccessBody()
	);

	async function signOut(): Promise<void> {
		if (isSigningOut) return;
		isSigningOut = true;
		try {
			const result = await authClient.signOut();
			// invalidateAll rather than a redirect: the load runs again, the hook
			// finds no session, and sign-in is reached the same way every other
			// signed-out visit reaches it.
			if (result.data?.success) await invalidateAll();
		} finally {
			isSigningOut = false;
		}
	}
</script>

<main class="flex flex-1 items-center justify-center px-4 py-12">
	<div class="w-full max-w-md">
		{#if orgName}
			<!-- They arrived from this org's email. Saying whose door this is costs
			     one line and answers "am I even in the right place". -->
			<p class="text-muted-foreground mb-6 text-center text-sm font-medium">{orgName}</p>
		{/if}

		<div class="border-border/70 bg-card rounded-xl border p-6 text-center sm:p-8">
			<div
				class="bg-muted text-muted-foreground mx-auto mb-5 flex size-11 items-center justify-center rounded-full"
				aria-hidden="true"
			>
				<MailQuestionIcon class="size-5" />
			</div>

			<h1 class="ps-serif text-xl font-semibold tracking-tight">{title}</h1>
			<p class="text-muted-foreground mt-2 text-sm leading-relaxed">{body}</p>

			{#if email}
				<!-- The single most useful fact on the page. Being invited at one
				     address and signed in with another is the ordinary cause, and it
				     is invisible until someone writes the address down. -->
				<div class="border-border/70 bg-muted/40 mt-6 rounded-lg border px-4 py-3 text-start">
					<p class="text-muted-foreground text-xs">{m.portal_noAccessSignedInAs()}</p>
					<p class="mt-0.5 truncate text-sm font-medium" title={email}>{email}</p>
				</div>
			{/if}

			<Button
				variant="outline"
				class="mt-4 w-full gap-2"
				loading={isSigningOut}
				onclick={() => void signOut()}
			>
				<LogOutIcon class="size-4" />
				{m.portal_noAccessSwitchAccount()}
			</Button>

			<p class="text-muted-foreground mt-6 text-xs leading-relaxed">
				{m.portal_noAccessHelp()}
			</p>
		</div>
	</div>
</main>
