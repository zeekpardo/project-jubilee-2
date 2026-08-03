<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';

	import { Portal } from '@ark-ui/svelte';
	import { toast } from 'svelte-sonner';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

	import * as Menu from '$lib/primitives/ui/menu';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { getSiteViewerContext } from '$lib/features/site/context.svelte';
	import * as m from '$lib/i18n/messages';

	// The viewer is read from context rather than threaded through props: the
	// public site layout is shared with pages that know nothing about identity,
	// and only this component ever needs to know who is signed in.
	const site = getSiteViewerContext();
	const { authClient } = getAuthContext();

	// Public-site HTML is cached by the CDN and served to every visitor alike,
	// so no personal detail may appear in it. `hydrated` is only set from an
	// effect, which never runs on the server and runs after hydration on the
	// client, so the server markup and the first client render both show the
	// anonymous state and identity is filled in afterwards.
	//
	// The disable below is load-bearing, not noise. `prefer-writable-derived`
	// ships a FIXER, and its fix rewrites this into a `$derived` — which
	// evaluates during SSR, puts the donor's name into the cached response, and
	// hands it to whoever asks for that URL next. A stray `eslint --fix` would
	// therefore turn a lint tidy-up into a cross-visitor data leak, silently and
	// with a green build. The rule is switched off here so it cannot.
	// eslint-disable-next-line svelte/prefer-writable-derived
	let hydrated = $state(false);
	$effect(() => {
		hydrated = true;
	});

	// While the viewer query is still in flight `site.viewer` is null, which is
	// the signed-out state — the header must never hold up the page or reserve
	// space for a name that may never arrive.
	const viewer = $derived(hydrated ? site.viewer : null);

	// Shared with the sign-in link so the trigger is visually indistinguishable
	// from the other header links.
	const headerLinkClass =
		'text-muted-foreground/80 hover:text-foreground focus-visible:ring-ring rounded-md text-xs font-medium tracking-wide transition-colors focus-visible:ring-2 focus-visible:outline-none';

	async function signOut(): Promise<void> {
		try {
			const result = await authClient.signOut();
			if (result.data?.success) {
				// Server loads captured the signed-in session, so they have to
				// re-run before the page agrees the visitor is anonymous.
				await invalidateAll();
				return;
			}
			toast.error(m.publicSite_accountSignOutFailed());
		} catch {
			toast.error(m.publicSite_accountSignOutFailed());
		}
	}
</script>

{#if viewer}
	<Menu.Root positioning={{ placement: 'bottom-end', gutter: 8 }}>
		<Menu.Trigger
			class="{headerLinkClass} flex items-center gap-1 outline-hidden"
			aria-label={m.publicSite_accountMenuLabel()}
		>
			<span class="max-w-32 truncate">{viewer.firstName}</span>
			<ChevronDownIcon class="size-3.5 shrink-0" />
		</Menu.Trigger>

		<Portal>
			<Menu.Content class="min-w-48 rounded-lg">
				<!-- The full display name only needs to be read, so it is a label
				     rather than an item: nothing here is selectable. -->
				<Menu.Label class="text-muted-foreground text-xs font-normal">
					{m.publicSite_accountSignedInAs({ name: viewer.displayName })}
				</Menu.Label>

				<Menu.Separator />

				<!-- Rendered as a real anchor so it can be opened in a new tab and
				     read as a link; the menu machine follows the href on Enter.

				     Scoped to the org whose page this header is on, not to the
				     session's active org: the same signed-in person can hold a record
				     at more than one org, and "Me" has to mean their record HERE. The
				     menu only appears at all when `site.viewer` resolved against this
				     same slug, so the two can never name different orgs. Resolved at
				     the attribute rather than in a `$derived` because that is the only
				     form `svelte/no-navigation-without-resolve` recognises. -->
				<Menu.Item value="__site-me">
					{#snippet asChild(props)}
						<a href={resolve('/(me)/[orgSlug]/me', { orgSlug: site.orgSlug })} {...props()}>
							{m.publicSite_accountMe()}
						</a>
					{/snippet}
				</Menu.Item>

				<!-- Staff only, and only staff OF THIS ORG — the server decides that
				     by comparing the session's active organization against the one
				     this page's slug names, because /app is session-scoped and a
				     dashboard link that quietly meant a different organization would
				     be the wrong offer rather than a broken one.

				     /app takes no parameters, but it still goes through resolve()
				     at the attribute like every other link here: the rule asks for
				     it regardless of arity, and one shape for all navigation is
				     easier to keep right than a rule about which links are exempt. -->
				{#if viewer.canAdminister}
					<Menu.Item value="__site-dashboard">
						{#snippet asChild(props)}
							<a href={resolve('/app')} {...props()}>
								{m.publicSite_accountDashboard()}
							</a>
						{/snippet}
					</Menu.Item>
				{/if}

				<Menu.Item value="__site-sign-out" onSelect={() => void signOut()}>
					{m.publicSite_accountSignOut()}
				</Menu.Item>
			</Menu.Content>
		</Portal>
	</Menu.Root>
{:else}
	<!--
		`resolve()` is called at the attribute rather than through a binding
		because `svelte/no-navigation-without-resolve` only recognises it there —
		it traces an identifier back to its declarator and a `$derived(...)` init
		fails that trace. The Me link above already does the same.
	-->
	<a href={resolve('/(site)/[orgSlug]/login', { orgSlug: site.orgSlug })} class={headerLinkClass}>
		{m.publicSite_signIn()}
	</a>
{/if}
